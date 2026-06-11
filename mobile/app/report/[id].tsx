import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { getReport } from "../../lib/data";
import { fmtDate, deviceTimezone } from "../../lib/format";
import { Screen, H2, Muted, Card, Badge, Loader } from "../../components/ui";
import { colors } from "../../lib/theme";
import type { ReportRow } from "../../lib/types";

function Section({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;
  return (
    <Card>
      <H2>{title}</H2>
      <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>{body}</Text>
    </Card>
  );
}

export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tz = deviceTimezone();
  const [report, setReport] = useState<ReportRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setReport(await getReport(id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) return <Loader />;
  if (!report) return (
    <Screen>
      <Muted>Report not found.</Muted>
    </Screen>
  );

  return (
    <Screen>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text, flex: 1 }}>
            {report.session?.course?.name ?? "Lesson report"}
          </Text>
          {report.published_at ? (
            <Badge label="published" color={colors.success} />
          ) : (
            <Badge label="draft" color={colors.warning} />
          )}
        </View>
        {report.session?.scheduled_start ? <Muted>{fmtDate(report.session.scheduled_start, tz)}</Muted> : null}
        {report.rating != null ? (
          <Text style={{ color: colors.indigo, fontWeight: "700", marginTop: 4 }}>
            Overall rating: {report.rating}/5
          </Text>
        ) : null}
      </Card>

      <Section title="Topics covered" body={report.topics_covered} />
      <Section title="How they did" body={report.how_student_did} />
      <Section title="Strengths" body={report.strengths} />
      <Section title="Areas to work on" body={report.areas_to_work} />
      <Section title="Homework" body={report.homework} />
    </Screen>
  );
}
