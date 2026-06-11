import { AppShell } from "@/components/app-shell";
import { requireProfile } from "@/lib/data/auth";
import { isDemoMode } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return (
    <AppShell profile={profile} demoMode={isDemoMode}>
      {children}
    </AppShell>
  );
}
