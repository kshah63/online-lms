import { withSentryConfig } from "@sentry/nextjs";

// Origins the lesson room (and, from Phase 3, the homework page) may embed:
// the Pencil Space iframe. Anything else is refused by the browser.
const pencilFrameOrigins = ["https://my.pencilapp.com", "https://staging.pencilapp.com"];
const extraPencilOrigin = (process.env.NEXT_PUBLIC_PENCIL_APP_ORIGIN ?? "").trim();
if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(extraPencilOrigin) && !pencilFrameOrigins.includes(extraPencilOrigin)) {
  pencilFrameOrigins.push(extraPencilOrigin);
}
const lessonCsp = `frame-src ${pencilFrameOrigins.join(" ")}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // tldraw ships its own ESM build; keep it transpiled with the app (homework
  // canvas still uses it until Phase 3).
  transpilePackages: ["tldraw"],
  // Enable the instrumentation.ts hook (Sentry server/edge init). Stable in
  // Next 15; still flagged in 14.x.
  experimental: { instrumentationHook: true },
  async headers() {
    const csp = [{ key: "Content-Security-Policy", value: lessonCsp }];
    return [
      { source: "/lesson/:path*", headers: csp },
      { source: "/hw/:path*", headers: csp },
    ];
  },
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
