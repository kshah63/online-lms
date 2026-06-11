import { AppShell } from "@/components/app-shell";
import { NotConfigured } from "@/components/not-configured";
import { requireProfile } from "@/lib/data/auth";
import { isDemoMode, isMisconfigured } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (isMisconfigured) return <NotConfigured />;
  const profile = await requireProfile();
  return (
    <AppShell profile={profile} demoMode={isDemoMode}>
      {children}
    </AppShell>
  );
}
