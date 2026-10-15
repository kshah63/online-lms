import { RequestAccessForm } from "@/components/auth/request-access-form";
import { BrandWordmark } from "@/components/brand";

export default function RequestAccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <BrandWordmark size={32} textClassName="text-lg" />
        </div>
        <RequestAccessForm />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Lessons on MathVision run in a shared online classroom and are recorded (audio + board) for the lesson
          report and the teacher&rsquo;s coaching. Families can ask us not to record; for teachers, recording and
          AI evaluation are a condition of teaching here.
        </p>
      </div>
    </div>
  );
}
