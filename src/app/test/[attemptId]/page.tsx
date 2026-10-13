import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Maximize2, ShieldCheck, Timer } from "lucide-react";
import { TestRunner } from "@/components/practice/test-runner";
import { Button } from "@/components/ui/button";
import { beginTestAction } from "@/lib/actions/attempts";
import { homePathForRole, requireProfile } from "@/lib/data/auth";
import { findMyPracticeRow, getAttemptQuestions, getMyAttempt, hasIntegrityCameraConsent, signQuestionImages } from "@/lib/data/attempts";
import { displayName } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * A timed test, full screen, for its student only. The id is an attempt
 * (from a 'test' ticket, or once started) — or, from /home/practice, the
 * assignment: then this is the entry page, the rules are read before
 * start_attempt runs, and the timer only starts on Begin.
 */
export default async function TestPage({ params }: { params: { attemptId: string } }) {
  const profile = await requireProfile();
  if (profile.role !== "student") redirect(homePathForRole(profile.role));

  const row = await findMyPracticeRow(profile, params.attemptId);
  if (!row || row.kind !== "test") notFound();
  const cameraConsented = await hasIntegrityCameraConsent(profile, profile.id);

  if (row.attempt_id === params.attemptId) {
    const [attempt, questions] = await Promise.all([getMyAttempt(profile, row.attempt_id), getAttemptQuestions(profile, row.attempt_id)]);
    if (!attempt) notFound();
    const imageUrls = Object.fromEntries(await signQuestionImages(questions));
    return (
      <TestRunner
        attemptId={attempt.id}
        selfId={profile.id}
        title={row.set_title}
        courseName={row.course_name}
        questions={questions}
        imageUrls={imageUrls}
        startedAtISO={attempt.started_at}
        timeLimitMinutes={attempt.time_limit_minutes}
        status={attempt.status}
        cameraConsented={cameraConsented}
        integrityFlagged={attempt.integrity_flagged}
        backHref="/home/practice"
      />
    );
  }

  // The assignment, not yet started: the entry page.
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3 md:px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/home/practice">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <div className="hidden h-6 w-px bg-border sm:block" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{row.set_title}</div>
          <div className="truncate text-xs text-muted-foreground">{row.course_name} · timed test · {row.question_count} questions</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 md:px-6">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold">{row.set_title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Hi {displayName(profile).split(" ")[0]}. Tests open in the browser so the timer and full-screen rules can be enforced. Read this before you start — the clock only starts when you press Begin.
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <Timer className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <strong>{row.question_count} questions.</strong> One at a time; you can go back to any of them until you submit.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Maximize2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <strong>Full screen, this tab only.</strong> Leaving either pauses the timer and is recorded; pasting, copying and developer tools are blocked and recorded.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                {cameraConsented ? (
                  <>
                    <strong>Camera on.</strong> Your family agreed to camera checks: a small photo is taken every minute and kept with the attempt for your teacher.
                  </>
                ) : (
                  <>
                    <strong>No camera.</strong> Your family has not turned on camera checks, so none are taken.
                  </>
                )}
              </span>
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">Too many events flag the attempt, and your teacher reviews it before the mark counts.</p>
        </div>
        <form action={beginTestAction} className="mt-5 flex items-center justify-end gap-3">
          <input type="hidden" name="assignment_id" value={row.assignment_id} />
          <Button asChild variant="ghost">
            <Link href="/home/practice">Not now</Link>
          </Button>
          <Button type="submit" size="lg">
            <Timer className="h-4 w-4" /> Begin — start the clock
          </Button>
        </form>
      </main>
    </div>
  );
}
