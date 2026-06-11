import { useCallback, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import { getReports } from "../../lib/data";
import { fmtDate, deviceTimezone } from "../../lib/format";
import { Screen, H1, Muted, Card, Badge, Loader, Empty } from "../../components/ui";
import { colors } from "../../lib/theme";
import type { ReportRow } from "../../lib/types";

export default function Reports() {
  const { profile } = useAuth();
  const router = useRouter();
  const tz = deviceTimezone();
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setReports(await getReports());
    } catch {
      setReports([]);
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

  if (!profile || reports === null) return <Loader />;
  const isStaff = profile.role === "admin" || profile.role === "teacher";

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <H1>Reports</H1>
      {reports.length === 0 ? (
        <Empty title="No reports yet" subtitle="Lesson reports appear here once published." />
      ) : (
        reports.map((r) => (
          <Pressable key={r.id} onPress={() => router.push(`/report/${r.id}`)}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text, flex: 1 }}>
                  {r.session?.course?.name ?? "Lesson report"}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </View>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {r.published_at ? (
                  <Badge label="published" color={colors.success} />
                ) : (
                  <Badge label="draft" color={colors.warning} />
                )}
                {r.rating != null ? <Muted>Rating {r.rating}/5</Muted> : null}
                {isStaff && r.session?.student?.display_name ? (
                  <Muted>· {r.session.student.display_name}</Muted>
                ) : null}
              </View>
              {r.session?.scheduled_start ? <Muted>{fmtDate(r.session.scheduled_start, tz)}</Muted> : null}
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
