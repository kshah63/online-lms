import { useCallback, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "../../lib/auth";
import { getUpcomingSessions, getHomework, getReports } from "../../lib/data";
import { fmtDateTime, relativeDay } from "../../lib/format";
import { deviceTimezone } from "../../lib/format";
import { Screen, H1, H2, Muted, Card, Badge, Button, Loader } from "../../components/ui";
import { colors, roleColor } from "../../lib/theme";
import type { SessionRow, HomeworkRow, ReportRow } from "../../lib/types";

export default function Home() {
  const { profile } = useAuth();
  const router = useRouter();
  const tz = deviceTimezone();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [homework, setHomework] = useState<HomeworkRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, h, r] = await Promise.all([getUpcomingSessions(), getHomework(), getReports()]);
      setSessions(s);
      setHomework(h);
      setReports(r);
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

  const next = sessions[0];
  const isStaff = profile.role === "admin" || profile.role === "teacher";
  const openHw = homework.filter((h) => h.status === "assigned" || h.status === "submitted").length;
  const toGrade = homework.filter((h) => h.status === "submitted").length;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Muted>Welcome back</Muted>
          <H1>{profile.display_name.split(" ")[0]}</H1>
        </View>
        <Badge label={profile.role} color={roleColor(profile.role)} />
      </View>

      <Card>
        <H2>Next lesson</H2>
        {next ? (
          <>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
              {next.course?.name ?? "Lesson"}
            </Text>
            <Muted>
              {relativeDay(next.scheduled_start, tz)} · {fmtDateTime(next.scheduled_start, tz)}
            </Muted>
            <Muted>
              {isStaff
                ? `Student: ${next.student?.display_name ?? "—"}`
                : `Teacher: ${next.teacher?.display_name ?? "to be assigned"}`}
            </Muted>
            <View style={{ marginTop: 8 }}>
              <Button title="View lessons" variant="outline" onPress={() => router.push("/(tabs)/lessons")} />
            </View>
          </>
        ) : (
          <Muted>No upcoming lessons.</Muted>
        )}
      </Card>

      <View style={{ flexDirection: "row", gap: 12 }}>
        <StatCard label={isStaff ? "To grade" : "Homework due"} value={isStaff ? toGrade : openHw} />
        <StatCard label="Reports" value={reports.length} />
      </View>

      {!isStaff ? (
        <Button title="Book a lesson" onPress={() => router.push("/book")} />
      ) : null}
    </Screen>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card style={{ flex: 1, alignItems: "flex-start" }}>
      <Text style={{ fontSize: 30, fontWeight: "800", color: colors.indigo }}>{value}</Text>
      <Muted>{label}</Muted>
    </Card>
  );
}
