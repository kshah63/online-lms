import { AlertTriangle } from "lucide-react";

/** Hard-fail screen shown in production when Supabase env vars are missing —
 * never silently fall through to the auto-admin demo mode in prod. */
export function NotConfigured() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <div className="max-w-md">
        <h1 className="text-lg font-semibold">App not configured</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This deployment is missing its database configuration
          (<code className="rounded bg-secondary px-1 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> /{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>). Set them in
          your hosting environment and redeploy.
        </p>
      </div>
    </div>
  );
}
