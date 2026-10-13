import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { AttemptRunner } from "@/components/practice/attempt-runner";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/data/auth";
import { findMyPracticeRow, getAttemptQuestions, signQuestionImages } from "@/lib/data/attempts";
import { PRACTICE_KIND_LABEL } from "@/lib/practice/attempts";

export const dynamic = "force-dynamic";

/**
 * One attempt, run by its student: attempt_questions (answers masked while in
 * progress) → answer_question per question → submit_attempt → the same rows
 * again, now with the answers and worked solutions the set allows. A parent is
 * sent back to the list: the questions and answers are the student's.
 */
export default async function AttemptPage({ params }: { params: { attemptId: string } }) {
  const profile = await requireRole("student", "parent");
  if (profile.role !== "student") redirect("/home/practice");

  const row = await findMyPracticeRow(profile, params.attemptId);
  if (!row || row.attempt_id !== params.attemptId || !row.attempt_status) notFound();
  if (row.kind === "test" && row.attempt_status === "in_progress") redirect(`/test/${row.attempt_id}`);

  const questions = await getAttemptQuestions(profile, row.attempt_id);
  const imageUrls = Object.fromEntries(await signQuestionImages(questions));

  return (
    <div>
      <PageHeader
        title={row.set_title}
        description={`${row.course_name} · ${PRACTICE_KIND_LABEL[row.kind]} · ${row.question_count} question${row.question_count === 1 ? "" : "s"}`}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/home/practice">
              <ChevronLeft className="h-4 w-4" /> All practice
            </Link>
          </Button>
        }
      />
      <div className="max-w-3xl">
        <AttemptRunner attemptId={row.attempt_id} kind={row.kind} initialQuestions={questions} imageUrls={imageUrls} initialStatus={row.attempt_status} />
      </div>
    </div>
  );
}
