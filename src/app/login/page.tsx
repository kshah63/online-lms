import { isDemoMode, isMisconfigured } from "@/lib/env";
import { demoProfiles } from "@/lib/demo/data";
import { setDemoPersona } from "@/lib/actions/auth";
import { SignInForm } from "@/components/auth/sign-in-form";
import { NotConfigured } from "@/components/not-configured";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

const ROLE_BLURB: Record<string, string> = {
  admin: "Daily schedule board, scheduling & teacher assignment",
  teacher: "Today's lessons, join the room, manage availability",
  student: "Upcoming lessons, reports, recordings to rewatch",
  parent: "Your child's lessons, reports and progress",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { message?: string };
}) {
  if (isMisconfigured) return <NotConfigured />;
  const message = searchParams?.message;
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand / pitch */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex"
        style={{ background: "linear-gradient(150deg, #2D3092 0%, #3a2f8a 38%, #F05A29 100%)" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white">
            <BrandMark size={30} />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Math<span className="text-[#F05A29]">Vision</span>
          </span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">
            Live 1-1 tutoring, built for students learning across the world.
          </h1>
          <p className="mt-4 text-white/85">
            Scheduling, embedded video, a shared notebook the student works in, AI coaching for teachers,
            and clear reports for parents — one platform.
          </p>
        </div>
        <div className="text-sm text-white/70">MathVision Global · every time shown in your own timezone.</div>
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-20 right-10 h-56 w-56 rounded-full bg-white/10 blur-2xl"
          aria-hidden
        />
      </div>

      {/* Auth panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 lg:hidden">
            <BrandWordmark size={32} textClassName="text-lg" />
          </div>

          {message && (
            <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              {message}
            </div>
          )}

          {isDemoMode ? <PersonaPicker /> : <SignInForm />}
        </div>
      </div>
    </div>
  );
}

function PersonaPicker() {
  const order = ["admin", "teacher", "student", "parent"];
  const personas = [...demoProfiles].sort(
    (a, b) => order.indexOf(a.role) - order.indexOf(b.role),
  );

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-xl font-semibold">Choose a persona</h2>
        <Badge variant="warning">Demo</Badge>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        No Supabase project is connected, so the app is running on built-in demo data. Pick someone to
        explore their view.
      </p>

      <div className="space-y-2">
        {personas.map((p) => (
          <form action={setDemoPersona} key={p.id}>
            <input type="hidden" name="persona_id" value={p.id} />
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <Avatar name={p.display_name} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{p.display_name}</span>
                  <Badge variant="secondary" className="capitalize">
                    {p.role}
                  </Badge>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{ROLE_BLURB[p.role]}</span>
              </span>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
