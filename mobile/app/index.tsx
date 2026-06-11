import { Redirect } from "expo-router";
import { useAuth } from "../lib/auth";
import { Loader } from "../components/ui";

export default function Index() {
  const { session, ready } = useAuth();
  if (!ready) return <Loader />;
  return <Redirect href={session ? "/(tabs)" : "/sign-in"} />;
}
