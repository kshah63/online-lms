import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import { Loader } from "../../components/ui";
import { colors } from "../../lib/theme";

type IconName = keyof typeof Ionicons.glyphMap;

function icon(name: IconName) {
  // eslint-disable-next-line react/display-name
  return ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );
}

export default function TabsLayout() {
  const { session, ready, profile } = useAuth();
  if (!ready) return <Loader />;
  if (!session) return <Redirect href="/sign-in" />;

  const isStaff = profile?.role === "admin" || profile?.role === "teacher";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home-outline") }} />
      <Tabs.Screen name="lessons" options={{ title: "Lessons", tabBarIcon: icon("calendar-outline") }} />
      <Tabs.Screen name="homework" options={{ title: "Homework", tabBarIcon: icon("book-outline") }} />
      <Tabs.Screen
        name="reports"
        options={{ title: "Reports", tabBarIcon: icon("document-text-outline") }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: isStaff ? "Manage" : "More", tabBarIcon: icon("ellipsis-horizontal") }}
      />
    </Tabs>
  );
}
