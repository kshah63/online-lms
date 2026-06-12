import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/auth";
import { Button } from "./ui";
import { colors } from "../lib/theme";

/** Full-screen biometric gate shown on cold start when biometrics are on. */
export function LockScreen() {
  const { unlock, signOut } = useAuth();

  // Prompt immediately on mount; the buttons below cover retry / bail out.
  useEffect(() => {
    void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={st.wrap}>
      <View style={st.mark}>
        <Text style={st.markText}>M</Text>
      </View>
      <Ionicons name="lock-closed" size={28} color={colors.indigo} style={{ marginTop: 24 }} />
      <Text style={st.title}>MathVision is locked</Text>
      <Text style={st.subtitle}>Unlock with Face ID or your fingerprint to continue.</Text>
      <View style={{ marginTop: 24, width: "100%", maxWidth: 280, gap: 10 }}>
        <Button title="Unlock" onPress={() => void unlock()} />
        <Button title="Sign out instead" variant="ghost" onPress={() => void signOut()} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: colors.bg },
  mark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.indigo,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: { color: colors.white, fontWeight: "800", fontSize: 28 },
  title: { marginTop: 12, fontSize: 18, fontWeight: "700", color: colors.text },
  subtitle: { marginTop: 4, fontSize: 14, color: colors.muted, textAlign: "center" },
});
