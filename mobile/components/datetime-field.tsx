import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { DateTime } from "luxon";
import { colors, radius } from "../lib/theme";

/**
 * Native date + time picker for booking. iOS renders the compact inline
 * controls; Android opens the system dialogs from a pressable field.
 */
export function DateTimeField({
  label,
  value,
  onChange,
  minimumDate,
}: {
  label: string;
  value: Date;
  onChange: (next: Date) => void;
  minimumDate?: Date;
}) {
  const [androidShow, setAndroidShow] = useState<"date" | "time" | null>(null);

  function onPicked(mode: "date" | "time") {
    return (event: DateTimePickerEvent, picked?: Date) => {
      if (Platform.OS === "android") setAndroidShow(null);
      if (event.type === "dismissed" || !picked) return;
      // Merge: keep the other half of the existing value.
      const cur = DateTime.fromJSDate(value);
      const p = DateTime.fromJSDate(picked);
      const next =
        mode === "date"
          ? cur.set({ year: p.year, month: p.month, day: p.day })
          : cur.set({ hour: p.hour, minute: p.minute, second: 0, millisecond: 0 });
      onChange(next.toJSDate());
    };
  }

  return (
    <View style={{ gap: 6 }}>
      <Text style={st.label}>{label}</Text>

      {Platform.OS === "ios" ? (
        <View style={st.iosRow}>
          <DateTimePicker
            value={value}
            mode="date"
            display="compact"
            minimumDate={minimumDate}
            onChange={onPicked("date")}
          />
          <DateTimePicker value={value} mode="time" display="compact" onChange={onPicked("time")} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable style={st.field} onPress={() => setAndroidShow("date")}>
            <Ionicons name="calendar-outline" size={16} color={colors.muted} />
            <Text style={st.fieldText}>{DateTime.fromJSDate(value).toFormat("ccc d LLL yyyy")}</Text>
          </Pressable>
          <Pressable style={st.field} onPress={() => setAndroidShow("time")}>
            <Ionicons name="time-outline" size={16} color={colors.muted} />
            <Text style={st.fieldText}>{DateTime.fromJSDate(value).toFormat("h:mm a")}</Text>
          </Pressable>
          {androidShow && (
            <DateTimePicker
              value={value}
              mode={androidShow}
              display="default"
              minimumDate={androidShow === "date" ? minimumDate : undefined}
              onChange={onPicked(androidShow)}
            />
          )}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: colors.text },
  iosRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
  },
  fieldText: { fontSize: 15, color: colors.text },
});
