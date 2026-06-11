import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../lib/auth";
import {
  getActableChildren,
  getEnrolledCourses,
  getAllCourses,
  requestEnrollment,
} from "../lib/data";
import { callBooking, webUrlConfigured } from "../lib/api";
import { deviceTimezone } from "../lib/format";
import { Screen, H2, Muted, Card, Button, Field, Loader } from "../components/ui";
import { colors } from "../lib/theme";
import type { ChildRow, CourseRow } from "../lib/types";

function Chips<T extends { id: string }>({
  items,
  selectedId,
  label,
  onSelect,
}: {
  items: T[];
  selectedId: string | null;
  label: (t: T) => string;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {items.map((it) => {
        const active = it.id === selectedId;
        return (
          <Pressable
            key={it.id}
            onPress={() => onSelect(it.id)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? colors.primary + "14" : colors.white,
            }}
          >
            <Text style={{ color: active ? colors.primary : colors.text, fontWeight: active ? "700" : "500" }}>
              {label(it)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Book() {
  const { profile } = useAuth();
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const enrollMode = mode === "enroll";
  const tz = deviceTimezone();

  const [children, setChildren] = useState<ChildRow[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [childId, setChildId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!profile) return;
      const kids = await getActableChildren(profile.id, profile.role);
      setChildren(kids);
      if (kids.length === 1) setChildId(kids[0].id);
      setLoading(false);
    })();
  }, [profile]);

  const loadCourses = useCallback(async () => {
    if (!childId) {
      setCourses([]);
      return;
    }
    setCourseId(null);
    setCourses(enrollMode ? await getAllCourses() : await getEnrolledCourses(childId));
  }, [childId, enrollMode]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  if (!profile) return <Loader />;
  if (loading) return <Loader />;

  async function submit() {
    if (!childId || !courseId) {
      Alert.alert("Almost there", "Pick a student and a course.");
      return;
    }
    setSaving(true);
    try {
      if (enrollMode) {
        await requestEnrollment(childId, courseId, profile!.id);
        Alert.alert("Request sent", "An admin will review your enrollment request.");
        router.back();
        return;
      }
      if (!date || !time) {
        Alert.alert("Almost there", "Pick a date and time.");
        setSaving(false);
        return;
      }
      const res = await callBooking({
        op: "book",
        student_id: childId,
        course_id: courseId,
        date,
        time,
        timezone: tz,
        duration: 60,
      });
      Alert.alert(res.ok ? "Done" : "Couldn't book", res.message);
      if (res.ok) router.back();
    } catch (e) {
      Alert.alert("Couldn't submit", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <H2>{enrollMode ? "Request a course" : "Book a lesson"}</H2>
      <Muted>
        {enrollMode
          ? "Choose who and which course. An admin approves enrollment."
          : "Choose the student, course and time. An admin assigns a teacher. Times use your device timezone."}
      </Muted>

      {!enrollMode && !webUrlConfigured ? (
        <Card style={{ borderColor: colors.warning + "55", backgroundColor: colors.warning + "12" }}>
          <Muted>Booking needs EXPO_PUBLIC_WEB_URL set to your deployed web app.</Muted>
        </Card>
      ) : null}

      {children.length > 1 ? (
        <Card style={{ gap: 10 }}>
          <Text style={{ fontWeight: "600", color: colors.text }}>Student</Text>
          <Chips items={children} selectedId={childId} label={(c) => c.display_name} onSelect={setChildId} />
        </Card>
      ) : null}

      <Card style={{ gap: 10 }}>
        <Text style={{ fontWeight: "600", color: colors.text }}>Course</Text>
        {courses.length === 0 ? (
          <Muted>{childId ? "No courses available." : "Pick a student first."}</Muted>
        ) : (
          <Chips items={courses} selectedId={courseId} label={(c) => c.name} onSelect={setCourseId} />
        )}
      </Card>

      {!enrollMode ? (
        <Card style={{ gap: 12 }}>
          <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-06-20" autoCapitalize="none" />
          <Field label="Time (24h, HH:MM)" value={time} onChangeText={setTime} placeholder="16:30" autoCapitalize="none" />
          <Muted>Timezone: {tz}</Muted>
        </Card>
      ) : null}

      <Button
        title={enrollMode ? "Send request" : "Request lesson"}
        onPress={submit}
        loading={saving}
        disabled={!childId || !courseId}
      />
    </Screen>
  );
}
