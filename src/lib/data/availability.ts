import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoAvailability } from "@/lib/demo/data";
import type { TeacherAvailability } from "@/lib/types";

export async function getAvailability(teacherId: string): Promise<TeacherAvailability[]> {
  if (isDemoMode) {
    return demoAvailability
      .filter((a) => a.teacher_id === teacherId)
      .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("teacher_availability")
    .select("*")
    .eq("teacher_id", teacherId)
    .order("weekday")
    .order("start_time");
  if (error) throw error;
  return (data ?? []) as TeacherAvailability[];
}
