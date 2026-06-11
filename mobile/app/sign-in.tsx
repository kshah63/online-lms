import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../lib/auth";
import { supabaseConfigured } from "../lib/supabase";
import { Screen, H1, Muted, Field, Button, Card } from "../components/ui";
import { colors } from "../lib/theme";

export default function SignIn() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    router.replace("/(tabs)");
  }

  return (
    <Screen>
      <View style={st.brand}>
        <View style={st.mark}>
          <Text style={st.markText}>M</Text>
        </View>
        <Text style={st.wordmark}>
          Math<Text style={{ color: colors.primary }}>Vision</Text>
        </Text>
      </View>

      <H1>Welcome back</H1>
      <Muted>Sign in to see lessons, homework and reports. Lessons themselves run on your iPad or laptop.</Muted>

      {!supabaseConfigured ? (
        <Card style={{ borderColor: colors.warning + "55", backgroundColor: colors.warning + "12" }}>
          <Text style={{ color: colors.warning, fontWeight: "600" }}>Not configured</Text>
          <Muted>
            Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in a .env file, then restart Expo.
          </Muted>
        </Card>
      ) : null}

      <Card style={{ gap: 14, marginTop: 8 }}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
        />
        {error ? <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text> : null}
        <Button title="Sign in" onPress={onSubmit} loading={loading} disabled={!email || !password} />
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  mark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.indigo,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: { color: colors.white, fontWeight: "800", fontSize: 20 },
  wordmark: { fontSize: 20, fontWeight: "700", color: colors.text },
});
