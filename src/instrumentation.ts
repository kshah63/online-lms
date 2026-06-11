// Next.js instrumentation hook — loads the right Sentry config per runtime.
// No-op unless a Sentry DSN is configured (see sentry.*.config.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
