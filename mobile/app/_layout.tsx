import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../lib/auth";
import { LockScreen } from "../components/lock-screen";
import { colors } from "../lib/theme";

/** Biometric gate at the root, so no screen (or deep link) renders while locked. */
function Gate() {
  const { locked } = useAuth();
  if (locked) return <LockScreen />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="book" options={{ title: "Book a lesson", presentation: "modal" }} />
      <Stack.Screen name="homework/[id]" options={{ title: "Homework" }} />
      <Stack.Screen name="report/[id]" options={{ title: "Report" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
