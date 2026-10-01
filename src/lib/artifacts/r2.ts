import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface R2Config {
  accountId: string;
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** r2.dev or custom domain base URL, e.g. https://pub-xxx.r2.dev */
  publicBaseUrl?: string;
  /** Cloudflare account API token — used to enable the r2.dev public URL. */
  apiToken?: string;
}

interface CloudflareApiResult<T> {
  success: boolean;
  result: T;
  errors?: Array<{ message: string }>;
}

interface ManagedDomain {
  domain: string;
  enabled: boolean;
}

/**
 * The Stripe Projects resource backing report artifacts. The project also has a
 * second `legible` bucket, so this is pinned rather than discovered — otherwise
 * which bucket wins depends on env var ordering.
 */
const DEFAULT_RESOURCE = "legible-assets";

/** `legible-assets` -> `LEGIBLE_ASSETS`, matching the CLI's env var prefixes. */
function envPrefix(resource: string): string {
  return resource.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
}

function readPrefixed(
  env: Record<string, string | undefined>,
  prefix: string,
): Record<string, string | undefined> {
  return {
    accountId: env[`${prefix}_ACCOUNT_ID`],
    bucket: env[`${prefix}_BUCKET_NAME`],
    endpoint: env[`${prefix}_ENDPOINT`],
    accessKeyId: env[`${prefix}_ACCESS_KEY_ID`] ?? env[`${prefix}_ACCESS_KEY`],
    secretAccessKey: env[`${prefix}_SECRET_ACCESS_KEY`],
    publicBaseUrl: env[`${prefix}_PUBLIC_URL`] ?? env[`${prefix}_BUCKET_URL`],
    apiToken: env[`${prefix}_API_TOKEN`] ?? env.CLOUDFLARE_API_TOKEN,
  };
}

/** Stripe Projects prefixes env vars with the resource name (e.g. LEGIBLE_ASSETS_*). */
function stripeR2Env(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const candidates = [
    env.ARTIFACTS_R2_RESOURCE,
    DEFAULT_RESOURCE,
    "cloudflare",
  ];

  for (const resource of candidates) {
    if (!resource) continue;
    const prefix = envPrefix(resource);
    if (env[`${prefix}_ENDPOINT`]) return readPrefixed(env, prefix);
  }

  // Fall back to any R2 bucket resource in the environment.
  for (const key of Object.keys(env)) {
    if (!key.endsWith("_ENDPOINT")) continue;
    if (!env[key]?.includes("r2.cloudflarestorage.com")) continue;
    return readPrefixed(env, key.slice(0, -"_ENDPOINT".length));
  }

  return {};
}

/**
 * Read R2 config from env using explicitly configured S3 keys.
 *
 * Returns null when they're absent — which is the norm for this project, since
 * Stripe Projects only hands out bucket metadata. Prefer {@link resolveR2Config},
 * which additionally derives keys from a Cloudflare API token.
 */
export function r2ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): R2Config | null {
  const base = r2BucketFromEnv(env);
  if (!base) return null;

  const { accessKeyId, secretAccessKey } = stripeR2Env(env);
  if (!accessKeyId || !secretAccessKey) return null;

  return { ...base, accessKeyId, secretAccessKey };
}

/** True when an upload could succeed — bucket plus some form of credential. */
export function artifactsConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const base = r2BucketFromEnv(env);
  if (!base) return false;
  const { accessKeyId, secretAccessKey } = stripeR2Env(env);
  return Boolean((accessKeyId && secretAccessKey) || base.apiToken);
}

/**
 * Resolve full S3 credentials, deriving them from a Cloudflare API token when
 * no explicit key pair is set.
 */
export async function resolveR2Config(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<R2Config | null> {
  const explicit = r2ConfigFromEnv(env);
  if (explicit) return explicit;

  const base = r2BucketFromEnv(env);
  if (!base?.apiToken) return null;

  const derived = await deriveS3Credentials(
    base.apiToken,
    base.accountId,
    fetchImpl,
  );
  return { ...base, ...derived };
}

/**
 * Turn an R2 API token into an S3 key pair: the token's ID is the access key ID
 * and the SHA-256 of its value is the secret. That lets a single
 * CLOUDFLARE_API_TOKEN both sign uploads and enable the r2.dev public URL.
 *
 * R2 tokens made in the dashboard are account-scoped, so the account verify
 * endpoint is tried before the user one.
 */
export async function deriveS3Credentials(
  apiToken: string,
  accountId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Pick<R2Config, "accessKeyId" | "secretAccessKey">> {
  const endpoints = [
    accountId &&
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
  ].filter((url): url is string => Boolean(url));

  let lastError: unknown;
  for (const url of endpoints) {
    try {
      const verified = await cloudflareJson<{ id: string }>(
        await fetchImpl(url, {
          headers: { Authorization: `Bearer ${apiToken}` },
        }),
      );
      if (verified.id) {
        return {
          accessKeyId: verified.id,
          secretAccessKey: secretFromApiTokenValue(apiToken),
        };
      }
    } catch (err) {
      lastError = err;
    }
  }

  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(
    `Could not resolve the Cloudflare API token ID${detail}. ` +
      "Set LEGIBLE_ASSETS_ACCESS_KEY_ID and LEGIBLE_ASSETS_SECRET_ACCESS_KEY explicitly instead.",
  );
}

/** Bucket metadata from Stripe Projects — no S3 credentials required. */
export function r2BucketFromEnv(
  env: Record<string, string | undefined> = process.env,
): Omit<R2Config, "accessKeyId" | "secretAccessKey"> | null {
  const vars = stripeR2Env(env);
  const { accountId, bucket, endpoint, publicBaseUrl, apiToken } = vars;

  if (!endpoint || !bucket || !accountId) return null;

  return {
    accountId,
    bucket,
    endpoint,
    publicBaseUrl: publicBaseUrl?.replace(/\/$/, ""),
    apiToken,
  };
}

export function artifactKey(origin: string, id: string): string {
  const host = new URL(origin).hostname.replace(/[^a-z0-9.-]/gi, "-");
  return `reports/${host}/${id}.html`;
}

export function publicObjectUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function s3Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/** Enable the bucket's r2.dev development URL and return its HTTPS base. */
export async function ensurePublicDevUrl(
  config: Pick<R2Config, "accountId" | "bucket" | "publicBaseUrl" | "apiToken">,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (config.publicBaseUrl) return config.publicBaseUrl;

  const token = config.apiToken;
  if (!token) {
    throw new Error(
      "Set CLOUDFLARE_PUBLIC_URL or CLOUDFLARE_API_TOKEN to publish artifacts publicly",
    );
  }

  const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/r2/buckets/${config.bucket}/domains/managed`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const current = await cloudflareJson<ManagedDomain>(
    await fetchImpl(`${base}`, { headers }),
  );

  if (current.enabled && current.domain) {
    return `https://${current.domain}`;
  }

  const updated = await cloudflareJson<ManagedDomain>(
    await fetchImpl(base, {
      method: "PUT",
      headers,
      body: JSON.stringify({ enabled: true }),
    }),
  );

  if (!updated.enabled || !updated.domain) {
    throw new Error("Cloudflare did not enable the r2.dev public URL");
  }

  return `https://${updated.domain}`;
}

async function cloudflareJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as CloudflareApiResult<T>;
  if (!res.ok || !body.success) {
    const msg =
      body.errors?.map((e) => e.message).join("; ") ??
      `Cloudflare API responded ${res.status}`;
    throw new Error(msg);
  }
  return body.result;
}

export interface UploadHtmlArtifactOptions {
  origin: string;
  id: string;
  html: string;
  config?: R2Config;
  fetchImpl?: typeof fetch;
  s3?: S3Client;
}

/** Upload a self-contained HTML report and return its public URL. */
export async function uploadHtmlArtifact(
  options: UploadHtmlArtifactOptions,
): Promise<string> {
  const config =
    options.config ?? (await resolveR2Config(process.env, options.fetchImpl));
  if (!config) {
    throw new Error(
      "R2 credentials missing — run `stripe projects env --pull`, then set CLOUDFLARE_API_TOKEN",
    );
  }

  const key = artifactKey(options.origin, options.id);
  const client = options.s3 ?? s3Client(config);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: options.html,
      ContentType: "text/html; charset=utf-8",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  const publicBase =
    config.publicBaseUrl ??
    (await ensurePublicDevUrl(config, options.fetchImpl));

  return publicObjectUrl(publicBase, key);
}

/** Derive S3 secret from a Cloudflare API token value (R2 auth-token pattern). */
export function secretFromApiTokenValue(tokenValue: string): string {
  return createHash("sha256").update(tokenValue).digest("hex");
}
