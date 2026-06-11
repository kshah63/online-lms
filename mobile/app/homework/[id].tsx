import { useCallback, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../lib/auth";
import { getHomeworkItem, gradeHomework, markHomework } from "../../lib/data";
import { fmtDate, deviceTimezone } from "../../lib/format";
import { webUrlConfigured } from "../../lib/api";
import { Screen, H2, Muted, Card, Badge, Button, Field, Loader } from "../../components/ui";
import { colors } from "../../lib/theme";
import type { HomeworkRow } from "../../lib/types";

const WEB = process.env.EXPO_PUBLIC_WEB_URL ?? "";

export default function HomeworkDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const router = useRouter();
  const tz = deviceTimezone();
  const [hw, setHw] = useState<HomeworkRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // teacher grading form
  const [correct, setCorrect] = useState("");
  const [incorrect, setIncorrect] = useState("");
  const [notDone, setNotDone] = useState("");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const item = await getHomeworkItem(id);
      setHw(item);
      if (item) {
        setCorrect(item.mark_correct?.toString() ?? "");
        setIncorrect(item.mark_incorrect?.toString() ?? "");
        setNotDone(item.mark_not_done?.toString() ?? "");
        setFeedback(item.feedback ?? "");
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading || !profile) return <Loader />;
  if (!hw) return (
    <Screen>
      <Muted>Homework not found.</Muted>
    </Screen>
  );

  const isStaff = profile.role === "admin" || profile.role === "teacher";
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  async function grade(verified: boolean) {
    setSaving(true);
    try {
      await gradeHomework(hw!.id, {
        verified,
        correct: num(correct),
        incorrect: num(incorrect),
        notDone: num(notDone),
        feedback: feedback.trim() || null,
      });
      Alert.alert("Saved", verified ? "Marked complete." : "Sent back to the student.");
      await load();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function setDone(done: boolean) {
    setSaving(true);
    try {
      await markHomework(hw!.id, done);
      await load();
    } catch (e) {
      Alert.alert("Couldn't update", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Card>
        <Badge label={hw.status} color={colors.indigo} />
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>{hw.description}</Text>
        {hw.course?.name ? <Muted>{hw.course.name}</Muted> : null}
        {isStaff && hw.student?.display_name ? <Muted>Student: {hw.student.display_name}</Muted> : null}
        {hw.due_at ? <Muted>Due {fmtDate(hw.due_at, tz)}</Muted> : null}
        {webUrlConfigured ? (
          <View style={{ marginTop: 8 }}>
            <Button
              title="Open on web (notebook + files)"
              variant="ghost"
              onPress={() => Linking.openURL(`${WEB.replace(/\/$/, "")}/hw/${hw.id}`)}
            />
          </View>
        ) : null}
      </Card>

      {isStaff ? (
        <Card style={{ gap: 12 }}>
          <H2>Mark the work</H2>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label="Correct" value={correct} onChangeText={setCorrect} keyboardType="number-pad" placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Incorrect" value={incorrect} onChangeText={setIncorrect} keyboardType="number-pad" placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Not done" value={notDone} onChangeText={setNotDone} keyboardType="number-pad" placeholder="0" />
            </View>
          </View>
          <Field
            label="Comment for parent / student"
            value={feedback}
            onChangeText={setFeedback}
            placeholder="What went well, what to revisit…"
            multiline
            style={{ height: 100, paddingTop: 12, textAlignVertical: "top" }}
          />
          <Button title="Mark complete" onPress={() => grade(true)} loading={saving} />
          <Button title="Send back as incomplete" variant="outline" onPress={() => grade(false)} disabled={saving} />
        </Card>
      ) : (
        <Card style={{ gap: 10 }}>
          <H2>Your work</H2>
          {hw.status === "completed" ? (
            <Muted>This homework is marked complete{hw.completed_at ? ` on ${fmtDate(hw.completed_at, tz)}` : ""}.</Muted>
          ) : (
            <Button title="Mark as done" onPress={() => setDone(true)} loading={saving} />
          )}
          {hw.feedback ? (
            <View style={{ marginTop: 6 }}>
              <Muted>Teacher feedback</Muted>
              <Text style={{ color: colors.text }}>{hw.feedback}</Text>
            </View>
          ) : null}
          {hw.mark_correct != null || hw.mark_incorrect != null ? (
            <Muted>
              Marked: {hw.mark_correct ?? 0} correct · {hw.mark_incorrect ?? 0} incorrect · {hw.mark_not_done ?? 0} not done
            </Muted>
          ) : null}
        </Card>
      )}
    </Screen>
  );
}
