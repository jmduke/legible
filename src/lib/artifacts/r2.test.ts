import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  artifactKey,
  artifactsConfigured,
  deriveS3Credentials,
  ensurePublicDevUrl,
  publicObjectUrl,
  r2BucketFromEnv,
  r2ConfigFromEnv,
  resolveR2Config,
  uploadHtmlArtifact,
} from "./r2";

const config = {
  accountId: "acct",
  bucket: "legible",
  endpoint: "https://acct.r2.cloudflarestorage.com",
  accessKeyId: "key",
  secretAccessKey: "secret",
  apiToken: "cf-token",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("r2ConfigFromEnv", () => {
  it("returns null without S3 credentials", () => {
    expect(
      r2ConfigFromEnv({
        CLOUDFLARE_ENDPOINT: "https://x.r2.cloudflarestorage.com",
        CLOUDFLARE_BUCKET_NAME: "b",
        CLOUDFLARE_ACCOUNT_ID: "a",
      }),
    ).toBeNull();
  });

  it("parses default CLOUDFLARE_* resource env vars", () => {
    expect(
      r2ConfigFromEnv({
        CLOUDFLARE_ENDPOINT: "https://x.r2.cloudflarestorage.com",
        CLOUDFLARE_BUCKET_NAME: "legible",
        CLOUDFLARE_ACCOUNT_ID: "acct",
        CLOUDFLARE_ACCESS_KEY_ID: "kid",
        CLOUDFLARE_SECRET_ACCESS_KEY: "sec",
        CLOUDFLARE_PUBLIC_URL: "https://pub-abc.r2.dev",
      }),
    ).toMatchObject({
      bucket: "legible",
      publicBaseUrl: "https://pub-abc.r2.dev",
    });
  });

  it("parses resource-prefixed env vars from Stripe Projects", () => {
    expect(
      r2BucketFromEnv({
        LEGIBLE_ASSETS_ENDPOINT: "https://x.r2.cloudflarestorage.com",
        LEGIBLE_ASSETS_BUCKET_NAME: "legible-assets",
        LEGIBLE_ASSETS_ACCOUNT_ID: "acct",
      }),
    ).toMatchObject({
      bucket: "legible-assets",
      endpoint: "https://x.r2.cloudflarestorage.com",
    });
  });

  it("prefers legible-assets over the other R2 bucket in the project", () => {
    expect(
      r2BucketFromEnv({
        LEGIBLE_ENDPOINT: "https://x.r2.cloudflarestorage.com",
        LEGIBLE_BUCKET_NAME: "legible",
        LEGIBLE_ACCOUNT_ID: "acct",
        LEGIBLE_ASSETS_ENDPOINT: "https://x.r2.cloudflarestorage.com",
        LEGIBLE_ASSETS_BUCKET_NAME: "legible-assets",
        LEGIBLE_ASSETS_ACCOUNT_ID: "acct",
      }),
    ).toMatchObject({ bucket: "legible-assets" });
  });

  it("honours an explicit ARTIFACTS_R2_RESOURCE override", () => {
    expect(
      r2BucketFromEnv({
        ARTIFACTS_R2_RESOURCE: "legible",
        LEGIBLE_ENDPOINT: "https://x.r2.cloudflarestorage.com",
        LEGIBLE_BUCKET_NAME: "legible",
        LEGIBLE_ACCOUNT_ID: "acct",
        LEGIBLE_ASSETS_ENDPOINT: "https://x.r2.cloudflarestorage.com",
        LEGIBLE_ASSETS_BUCKET_NAME: "legible-assets",
        LEGIBLE_ASSETS_ACCOUNT_ID: "acct",
      }),
    ).toMatchObject({ bucket: "legible" });
  });
});

describe("artifactsConfigured", () => {
  const bucket = {
    LEGIBLE_ASSETS_ENDPOINT: "https://x.r2.cloudflarestorage.com",
    LEGIBLE_ASSETS_BUCKET_NAME: "legible-assets",
    LEGIBLE_ASSETS_ACCOUNT_ID: "acct",
  };

  it("is false with bucket metadata alone", () => {
    expect(artifactsConfigured(bucket)).toBe(false);
  });

  it("is true once an API token is available", () => {
    expect(
      artifactsConfigured({ ...bucket, CLOUDFLARE_API_TOKEN: "tok" }),
    ).toBe(true);
  });
});

const okToken = (id: string) =>
  new Response(JSON.stringify({ success: true, result: { id } }));

const badToken = (message: string) =>
  new Response(
    JSON.stringify({ success: false, result: null, errors: [{ message }] }),
    { status: 401 },
  );

describe("deriveS3Credentials", () => {
  it("uses the token ID as key and sha256(token) as secret", async () => {
    const fetchMock = vi.fn(async () => okToken("token-id"));

    await expect(
      deriveS3Credentials("cf-token", "acct", fetchMock),
    ).resolves.toEqual({
      accessKeyId: "token-id",
      secretAccessKey: createHash("sha256").update("cf-token").digest("hex"),
    });
  });

  it("checks the account-scoped endpoint first", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) =>
      okToken("token-id"),
    );
    await deriveS3Credentials("cf-token", "acct", fetchMock);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/tokens/verify",
    );
  });

  it("falls back to the user endpoint for user-scoped tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(badToken("Invalid account"))
      .mockResolvedValueOnce(okToken("user-token-id"));

    await expect(
      deriveS3Credentials("cf-token", "acct", fetchMock),
    ).resolves.toMatchObject({ accessKeyId: "user-token-id" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains how to set keys manually when both lookups fail", async () => {
    const fetchMock = vi.fn(async () => badToken("Invalid API Token"));

    await expect(deriveS3Credentials("bad", "acct", fetchMock)).rejects.toThrow(
      /Invalid API Token[\s\S]*ACCESS_KEY_ID/,
    );
  });
});

describe("resolveR2Config", () => {
  const bucket = {
    LEGIBLE_ASSETS_ENDPOINT: "https://x.r2.cloudflarestorage.com",
    LEGIBLE_ASSETS_BUCKET_NAME: "legible-assets",
    LEGIBLE_ASSETS_ACCOUNT_ID: "acct",
  };

  it("derives credentials from an API token", async () => {
    const fetchMock = vi.fn(async () => okToken("token-id"));

    await expect(
      resolveR2Config({ ...bucket, CLOUDFLARE_API_TOKEN: "tok" }, fetchMock),
    ).resolves.toMatchObject({
      bucket: "legible-assets",
      accessKeyId: "token-id",
    });
  });

  it("prefers explicit keys without calling Cloudflare", async () => {
    const fetchMock = vi.fn();

    await expect(
      resolveR2Config(
        {
          ...bucket,
          LEGIBLE_ASSETS_ACCESS_KEY_ID: "kid",
          LEGIBLE_ASSETS_SECRET_ACCESS_KEY: "sec",
          CLOUDFLARE_API_TOKEN: "tok",
        },
        fetchMock,
      ),
    ).resolves.toMatchObject({ accessKeyId: "kid", secretAccessKey: "sec" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null with no credentials at all", async () => {
    await expect(resolveR2Config(bucket)).resolves.toBeNull();
  });
});

describe("artifactKey", () => {
  it("names reports by host and id", () => {
    expect(artifactKey("https://example.com", "scan-1")).toBe(
      "reports/example.com/scan-1.html",
    );
  });
});

describe("publicObjectUrl", () => {
  it("encodes path segments", () => {
    expect(publicObjectUrl("https://pub.r2.dev", "reports/a b/c.html")).toBe(
      "https://pub.r2.dev/reports/a%20b/c.html",
    );
  });
});

describe("ensurePublicDevUrl", () => {
  it("returns configured base URL without calling Cloudflare", async () => {
    const fetchMock = vi.fn();
    await expect(
      ensurePublicDevUrl(
        { ...config, publicBaseUrl: "https://pub-test.r2.dev" },
        fetchMock,
      ),
    ).resolves.toBe("https://pub-test.r2.dev");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enables the managed r2.dev domain when needed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { domain: "pub-abc.r2.dev", enabled: false },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { domain: "pub-abc.r2.dev", enabled: true },
          }),
        ),
      );

    await expect(ensurePublicDevUrl(config, fetchMock)).resolves.toBe(
      "https://pub-abc.r2.dev",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("uploadHtmlArtifact", () => {
  it("uploads HTML and returns a public URL", async () => {
    const send = vi.fn(async () => ({}));
    const s3 = { send } as unknown as import("@aws-sdk/client-s3").S3Client;

    const url = await uploadHtmlArtifact({
      origin: "https://example.com",
      id: "scan-1",
      html: "<html></html>",
      config: { ...config, publicBaseUrl: "https://pub-test.r2.dev" },
      s3,
    });

    expect(url).toBe("https://pub-test.r2.dev/reports/example.com/scan-1.html");
    expect(send).toHaveBeenCalledOnce();
  });
});
