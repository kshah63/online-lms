"use client";

// Root-level error boundary (App Router). Reports the error to Sentry (no-op
// without a DSN) and renders a minimal standalone fallback — global-error
// replaces the whole document, so it can't rely on the app shell or styles.
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: 420 }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: 8, color: "#64748b", fontSize: "0.875rem" }}>
            An unexpected error occurred. Please try again.
          </p>
          {error.digest && (
            <p style={{ marginTop: 8, fontFamily: "monospace", fontSize: "0.75rem", color: "#94a3b8" }}>
              Digest: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{ marginTop: 16, padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
