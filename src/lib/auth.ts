import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "@/db";

/**
 * Sign-in and GSC access share one Google OAuth grant: we ask for the
 * webmasters.readonly scope up front so the refresh token stored on the
 * account row can mint Search Console clients for the worker.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  socialProviders: {
    google: {
      // biome-ignore lint/style/noNonNullAssertion: fail fast if unset
      clientId: process.env.GOOGLE_CLIENT_ID!,
      // biome-ignore lint/style/noNonNullAssertion: fail fast if unset
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      scope: ["https://www.googleapis.com/auth/webmasters.readonly"],
      accessType: "offline",
      prompt: "consent",
    },
  },
});

export type Session = typeof auth.$Infer.Session;
