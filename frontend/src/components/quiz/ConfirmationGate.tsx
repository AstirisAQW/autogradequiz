"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface ConfirmationGateProps {
  title: string;
  description: string;
  confirmed: number;
  needed: number;
  unconfirmedCount: number;
  quizId: string;
  onUploadPapers?: () => void;
  onGoToPapers?: () => void;
}

export function ConfirmationGate({
  title,
  description,
  confirmed,
  needed,
  unconfirmedCount,
  quizId,
  onUploadPapers,
  onGoToPapers,
}: ConfirmationGateProps) {
  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2>{title}</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          {description}
        </p>
      </div>

      <div className="max-w-[360px] space-y-1.5">
        <p className="text-[0.8125rem] font-medium text-[var(--text-primary)] tabular-nums">
          {confirmed} of {needed} confirmed papers
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]">
          <div
            className="h-full rounded-full bg-[var(--brand)] transition-[width]"
            style={{
              width: `${(Math.min(confirmed, needed) / needed) * 100}%`,
            }}
          />
        </div>
      </div>

      {unconfirmedCount > 0 ? (
        <div>
          <Link href={`/review?quiz_id=${quizId}`}>
            <Button variant="primary">
              Review {unconfirmedCount}{" "}
              {unconfirmedCount === 1 ? "paper" : "papers"}
            </Button>
          </Link>
        </div>
      ) : onUploadPapers ? (
        <div>
          <Button variant="primary" onClick={onUploadPapers}>
            Upload papers
          </Button>
        </div>
      ) : onGoToPapers ? (
        <div>
          <Button variant="primary" onClick={onGoToPapers}>
            Open papers
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
