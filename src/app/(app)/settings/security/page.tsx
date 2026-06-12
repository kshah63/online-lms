import { requireProfile } from "@/lib/data/auth";
import { isDemoMode } from "@/lib/env";
import { SecuritySettings } from "@/components/auth/security-settings";

export default async function SecurityPage() {
  await requireProfile();
  return (
    <div>
      <h1 className="text-xl font-semibold">Account security</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Change your password and manage two-factor authentication.
      </p>
      <SecuritySettings demoMode={isDemoMode} />
    </div>
  );
}
