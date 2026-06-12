import { useCallback, useEffect, useState } from "react";
import { RefreshControl, Switch, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "../../lib/auth";
import { getOpenFollowups } from "../../lib/data";
import { fmtDate, deviceTimezone } from "../../lib/format";
import {
  authenticate,
  getBiometricEnabled,
  isBiometricAvailable,
  setBiometricEnabled,
} from "../../lib/biometric";
import { Screen, H1, H2, Muted, Card, Badge, Button, Loader, Empty } from "../../components/ui";
import { colors, roleColor } from "../../lib/theme";
import type { FollowupRow } from "../../lib/types";

function BiometricCard() {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      setAvailable(await isBiometricAvailable());
      setEnabled(await getBiometricEnabled());
    })();
  }, []);

  async function toggle(next: boolean) {
    if (next) {
      // Prove the biometric works before trusting it as the lock.
      const ok = await authenticate();
      if (!ok) return;
    }
    await setBiometricEnabled(next);
    setEnabled(next);
  }

  if (!available) return null;

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <H2>Biometric unlock</H2>
          <Muted>Require Face ID / fingerprint when the app opens.</Muted>
        </View>
        <Switch
          value={enabled}
          onValueChange={(v) => void toggle(v)}
          trackColor={{ true: colors.primary }}
        />
      </View>
    </Card>
  );
}

export default function More() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const tz = deviceTimezone();
  const [followups, setFollowups] = useState<FollowupRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const isStaff = profile?.role === "admin" || profile?.role === "teacher";

  const load = useCallback(async () => {
    if (!isStaff) return;
    try {
      setFollowups(await getOpenFollowups());
    } catch {
      setFollowups([]);
    }
  }, [isStaff]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!profile) return <Loader />;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <H1>{isStaff ? "Manage" : "More"}</H1>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>{profile.display_name}</Text>
            <Muted>{profile.email ?? ""}</Muted>
            <Muted>Timezone: {profile.timezone}</Muted>
          </View>
          <Badge label={profile.role} color={roleColor(profile.role)} />
        </View>
      </Card>

      <BiometricCard />

      {!isStaff ? (
        <Card>
          <H2>Enrollment</H2>
          <Muted>Ask to be added to a course. An admin will review your request.</Muted>
          <View style={{ marginTop: 8 }}>
            <Button title="Request a course" variant="outline" onPress={() => router.push("/book?mode=enroll")} />
          </View>
        </Card>
      ) : null}

      {isStaff ? (
        <View style={{ gap: 12 }}>
          <H2>Open follow-ups</H2>
          {followups.length === 0 ? (
            <Empty title="Nothing needs attention" subtitle="Flagged students appear here." />
          ) : (
            followups.map((f) => (
              <Card key={f.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontWeight: "700", color: colors.text }}>
                    {f.student?.display_name ?? "Student"}
                  </Text>
                  <Badge
                    label={f.priority}
                    color={f.priority === "high" ? colors.danger : colors.warning}
                  />
                </View>
                <Muted>{f.type.replace(/_/g, " ")}</Muted>
                {f.reason ? <Text style={{ color: colors.text }}>{f.reason}</Text> : null}
                <Muted>{fmtDate(f.created_at, tz)}</Muted>
              </Card>
            ))
          )}
        </View>
      ) : null}

      <View style={{ marginTop: 8 }}>
        <Button title="Sign out" variant="danger" onPress={signOut} />
      </View>

      <Muted style={{ textAlign: "center", marginTop: 8 }}>MathVision Global</Muted>
    </Screen>
  );
}
