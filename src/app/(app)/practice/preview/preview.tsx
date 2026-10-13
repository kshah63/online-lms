"use client";

import { useState } from "react";
import { PracticeRunner, type PracticeMode } from "@/components/practice/practice-runner";
import { SAMPLE_QUESTIONS } from "@/lib/practice/samples";
import { cn } from "@/lib/utils";

export function PracticePreview() {
  const [mode, setMode] = useState<PracticeMode>("practice");
  const [submitted, setSubmitted] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["practice", "test"] as PracticeMode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setSubmitted(false);
            }}
            className={cn("rounded-md border px-3 py-1.5 text-sm", mode === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-secondary")}
          >
            {m === "practice" ? "Practice mode" : "Test mode"}
          </button>
        ))}
      </div>
      <PracticeRunner
        key={mode}
        questions={SAMPLE_QUESTIONS}
        mode={mode}
        title={mode === "practice" ? "Quadratics — practice set" : "Quadratics — topic test"}
        submitted={submitted}
        onSubmit={() => setSubmitted(true)}
        onAttachNotebook={() => undefined}
        onAttachPhoto={() => undefined}
      />
    </div>
  );
}
