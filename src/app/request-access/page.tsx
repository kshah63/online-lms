import { GraduationCap } from "lucide-react";
import { RequestAccessForm } from "@/components/auth/request-access-form";

export default function RequestAccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold">Lessons</span>
        </div>
        <RequestAccessForm />
      </div>
    </div>
  );
}
