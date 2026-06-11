import { redirect } from "next/navigation";
import { getCurrentProfile, homePathForRole } from "@/lib/data/auth";

export default async function RootPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  redirect(homePathForRole(profile.role));
}
