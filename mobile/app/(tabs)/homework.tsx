import { useCallback, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import { getHomework } from "../../lib/data";
import { fmtDate, deviceTimezone } from "../../lib/format";
import { Screen, H1, Muted, Card, Badge, Loader, Empty } from "../../components/ui";
import { colors } from "../../lib/theme";
import type { HomeworkRow } from "../../lib/types";

const STATUS_COLOR: Record<string, string> = {
  assigned: colors.warning,
  submitted: colors.indigo,
  completed: colors.success,
  incomplete: colors.danger,
};

export default function Homework() {
  const { profile } = useAuth();
  const router = useRouter();
  const tz = deviceTimezone();
  const [items, setItems] = useState<HomeworkRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await getHomework());
    } catch {
      setItems([]);
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

  if (!profile || items === null) return <Loader />;
  const isStaff = profile.role === "admin" || profile.role === "teacher";

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <H1>Homework</H1>
      {items.length === 0 ? (
        <Empty title="No homework yet" subtitle={isStaff ? "Assignments you set appear here." : "Homework from lessons appears here."} />
      ) : (
        items.map((h) => (
          <Pressable key={h.id} onPress={() => router.push(`/homework/${h.id}`)}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text, flex: 1 }} numberOfLines={2}>
                  {h.description}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </View>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Badge label={h.status} color={STATUS_COLOR[h.status] ?? colors.muted} />
                {h.course?.name ? <Muted>{h.course.name}</Muted> : null}
                {isStaff && h.student?.display_name ? <Muted>· {h.student.display_name}</Muted> : null}
              </View>
              {h.due_at ? <Muted>Due {fmtDate(h.due_at, tz)}</Muted> : null}
              {h.status === "completed" && (h.mark_correct != null || h.mark_incorrect != null) ? (
                <Muted>
                  Marked: {h.mark_correct ?? 0} correct · {h.mark_incorrect ?? 0} incorrect · {h.mark_not_done ?? 0} not done
                </Muted>
              ) : null}
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
