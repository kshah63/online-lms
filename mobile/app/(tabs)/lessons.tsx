import { useCallback, useState } from "react";
import { Linking, RefreshControl, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "../../lib/auth";
import { getUpcomingSessions } from "../../lib/data";
import { fmtDateTime, relativeDay, deviceTimezone } from "../../lib/format";
import { lessonWebUrl, webUrlConfigured } from "../../lib/api";
import { Screen, H1, Muted, Card, Badge, Button, Loader, Empty } from "../../components/ui";
import { colors } from "../../lib/theme";
import type { SessionRow } from "../../lib/types";

export default function Lessons() {
  const { profile } = useAuth();
  const router = useRouter();
  const tz = deviceTimezone();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions(await getUpcomingSessions());
    } catch {
      setSessions([]);
    }
  }, []);

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

  if (!profile || sessions === null) return <Loader />;
  const isStaff = profile.role === "admin" || profile.role === "teacher";

  function joinable(start: string) {
    // Allow joining from 10 min before start until 2h after.
    const t = new Date(start).getTime();
    const now = Date.now();
    return now >= t - 10 * 60_000 && now <= t + 120 * 60_000;
  }

  async function join(s: SessionRow) {
    if (!webUrlConfigured) return;
    await Linking.openURL(lessonWebUrl(s.id));
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <H1>Lessons</H1>
        {!isStaff ? <Button title="Book" variant="outline" onPress={() => router.push("/book")} /> : null}
      </View>

      {sessions.length === 0 ? (
        <Empty title="No upcoming lessons" subtitle={isStaff ? "Assigned lessons appear here." : "Book one to get started."} />
      ) : (
        sessions.map((s) => (
          <Card key={s.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text, flex: 1 }}>
                {s.course?.name ?? "Lesson"}
              </Text>
              <Badge
                label={s.status === "in_progress" ? "live" : relativeDay(s.scheduled_start, tz)}
                color={s.status === "in_progress" ? colors.success : colors.indigo}
              />
            </View>
            <Muted>{fmtDateTime(s.scheduled_start, tz)}</Muted>
            <Muted>
              {isStaff
                ? `Student: ${s.student?.display_name ?? "—"}`
                : `Teacher: ${s.teacher?.display_name ?? "to be assigned"}`}
            </Muted>
            {s.agenda ? <Text style={{ color: colors.text, marginTop: 4 }}>{s.agenda}</Text> : null}

            {joinable(s.scheduled_start) && webUrlConfigured ? (
              <View style={{ marginTop: 8 }}>
                <Button title="Join lesson (opens in browser)" onPress={() => join(s)} />
              </View>
            ) : (
              <Muted style={{ marginTop: 6 }}>
                {webUrlConfigured
                  ? "Join opens here ~10 min before start. Lessons run on iPad/laptop."
                  : "Set EXPO_PUBLIC_WEB_URL to enable Join."}
              </Muted>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}
