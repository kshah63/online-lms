import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, space } from "../lib/theme";

export function Screen({
  children,
  scroll = true,
  refreshControl,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement;
}) {
  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={s.scrollContent}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={s.h1}>{children}</Text>;
}
export function H2({ children }: { children: React.ReactNode }) {
  return <Text style={s.h2}>{children}</Text>;
}
export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}
export function Body({ children }: { children: React.ReactNode }) {
  return <Text style={s.body}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Badge({ label, color = colors.indigo }: { label: string; color?: string }) {
  return (
    <View style={[s.badge, { backgroundColor: color + "1A", borderColor: color + "44" }]}>
      <Text style={[s.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "outline" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
}) {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const bg = isPrimary ? colors.primary : isDanger ? colors.danger : "transparent";
  const fg = isPrimary || isDanger ? colors.white : colors.text;
  const border = variant === "outline" ? colors.border : "transparent";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[s.buttonText, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, style, ...props }: { label: string } & TextInputProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput style={[s.input, style]} placeholderTextColor={colors.muted} {...props} />
    </View>
  );
}

export function Loader({ label }: { label?: string }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Text style={[s.muted, { marginTop: 12 }]}>{label}</Text> : null}
    </View>
  );
}

export function Empty({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Card style={{ alignItems: "center", paddingVertical: 28 }}>
      <Text style={s.emptyTitle}>{title}</Text>
      {subtitle ? <Muted style={{ marginTop: 4 }}>{subtitle}</Muted> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.md, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  h1: { fontSize: 26, fontWeight: "700", color: colors.text },
  h2: { fontSize: 17, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { fontSize: 13, color: colors.muted },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: 8,
  },
  badge: { alignSelf: "flex-start", borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
  button: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
  label: { fontSize: 13, fontWeight: "600", color: colors.text },
  input: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.text,
  },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
});

export { colors };
