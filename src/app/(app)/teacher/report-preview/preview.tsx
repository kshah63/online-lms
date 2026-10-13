"use client";

import { SessionReportEditor } from "@/components/teacher/session-report-editor";
import { draftSessionReportAction, submitSessionReportAction } from "@/lib/actions/session-report";

const TOPICS = ["Quadratics", "Completing the square", "Simultaneous equations", "Surds and indices", "Coordinate geometry"];

export function ReportPreview() {
  return (
    <SessionReportEditor
      studentName="Aarav Sharma"
      course="IGCSE Maths (Extended)"
      topicOptions={TOPICS}
      bookedTopic="Quadratics"
      signs
      initialNotes="Solid on factorising. Kept dropping the sign when the x² coefficient isn't 1. Did a 5-question quick check: 3/5."
      onDraft={(notes) => draftSessionReportAction({ sessionId: "demo", notes, studentName: "Aarav Sharma", course: "IGCSE Maths (Extended)", topicOptions: TOPICS, bookedTopic: "Quadratics", signs: true })}
      onSubmit={(draft) => submitSessionReportAction("demo", draft)}
    />
  );
}
