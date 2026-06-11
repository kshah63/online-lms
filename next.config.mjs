import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // tldraw ships its own ESM build; keep it transpiled with the app.
  transpilePackages: ["tldraw"],
  // Enable the instrumentation.ts hook (Sentry server/edge init). Stable in
  // Next 15; still flagged in 14.x.
  experimental: { instrumentationHook: true },
};

// Only apply the Sentry build plugin when a DSN is configured, so builds without
// Sentry stay completely untouched (no plugin, no warnings, no source-map step).
const sentryEnabled = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN, // source-map upload only if set
      silent: true,
      disableLogger: true, // tree-shake Sentry logger statements
      widenClientFileUpload: true,
    })
  : nextConfig;
