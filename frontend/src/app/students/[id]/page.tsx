"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StudentFormDrawer } from "@/components/roster/StudentFormDrawer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocumentIcon, UsersIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/format";
import { formatPointsValue } from "@/lib/scoring";
import {
  getRoster,
  getStudentDetail,
  type SectionWithCount,
  type StudentDetail,
  type StudentGradedPaperItem,
} from "@/lib/workspace";

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const studentId = params.id;

  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [allClasses, setAllClasses] = useState<SectionWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [studentDetail, roster] = await Promise.all([
        getStudentDetail(studentId),
        getRoster(),
      ]);
      if (!studentDetail) {
        setDetail(null);
        setNotFound(true);
        return;
      }
      setDetail(studentDetail);
      setAllClasses(roster.sections);
      setNotFound(false);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  if (loading && !detail) {
    return (
      <div className="space-y-6">
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="space-y-4">
        <Link
          href="/students"
          className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          ← Back to students
        </Link>
        <EmptyState
          icon={<UsersIcon />}
          title="Student not found"
          description="This student does not exist in the local workspace."
          action={
            <Link
              href="/students"
              className="inline-flex rounded-[8px] bg-[var(--brand)] px-3.5 py-2 text-[14px] font-medium text-white hover:bg-[var(--brand-hover)]"
            >
              View all students
            </Link>
          }
        />
      </div>
    );
  }

  const { student, sections, gradedPapers } = detail;

  const paperColumns: DataTableColumn<StudentGradedPaperItem>[] = [
    {
      key: "quiz",
      header: "Quiz",
      render: (item) => (
        <Link
          href={`/quizzes/${item.quiz.id}`}
          className="font-medium text-[var(--text-primary)] hover:text-[var(--brand-text)] hover:underline"
        >
          {item.quiz.name}
        </Link>
      ),
    },
    {
      key: "date",
      header: "Date",
      render: (item) => (
        <span className="text-[var(--text-secondary)] tabular-nums">
          {item.paper.dateText ||
            item.quiz.date ||
            formatDate(item.paper.createdAt)}
        </span>
      ),
    },
    {
      key: "keyVersion",
      header: "Key",
      render: (item) => (
        <span className="font-mono text-[13px]">
          {item.paper.keyVersion ?? "A"}
        </span>
      ),
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      render: (item) => {
        const pct =
          item.totalPoints > 0
            ? Math.round((item.earnedPoints / item.totalPoints) * 100)
            : 0;
        return (
          <span className="font-mono tabular-nums">
            {formatPointsValue(item.earnedPoints)} /{" "}
            {formatPointsValue(item.totalPoints)} pts ({pct}%)
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (item) =>
        item.paper.needsReview ? (
          <Badge variant="warning">Needs review</Badge>
        ) : (
          <Badge variant="success">Graded</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <nav
          aria-label="Breadcrumb"
          className="text-[13px] text-[var(--text-secondary)]"
        >
          <Link href="/students" className="hover:text-[var(--text-primary)]">
            ← Students
          </Link>{" "}
          <span className="text-[var(--text-muted)]">/</span>{" "}
          <span className="text-[var(--text-primary)]">
            {student.lastName}, {student.firstName}
          </span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1>
              {student.firstName} {student.lastName}
            </h1>
            <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
              Student ID:{" "}
              <span className="font-mono text-[var(--text-primary)]">
                {student.studentCode}
              </span>
            </p>
          </div>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Edit student
          </Button>
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-4 text-[14px] sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="text-[12px] font-medium text-[var(--text-muted)]">
              First Name
            </p>
            <p className="mt-1 font-medium text-[var(--text-primary)]">
              {student.firstName}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-medium text-[var(--text-muted)]">
              Last Name
            </p>
            <p className="mt-1 font-medium text-[var(--text-primary)]">
              {student.lastName}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-medium text-[var(--text-muted)]">
              Student ID
            </p>
            <p className="mt-1 font-mono font-medium text-[var(--text-primary)] tabular-nums">
              {student.studentCode}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-medium text-[var(--text-muted)]">
              External Reference
            </p>
            <p className="mt-1 text-[var(--text-primary)]">
              {student.externalRef || "—"}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-medium text-[var(--text-muted)]">
              Classes
            </p>
            {sections.length === 0 ? (
              <p className="mt-1 text-[var(--text-muted)]">None</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {sections.map((sec) => (
                  <Link
                    key={sec.id}
                    href={`/classes/${sec.id}`}
                    className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--brand-text)]"
                  >
                    {sec.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2>Graded Quizzes ({gradedPapers.length})</h2>
        </div>

        {gradedPapers.length === 0 ? (
          <EmptyState
            icon={<DocumentIcon />}
            title="No graded quizzes yet"
            description="Graded answer sheets linked to this student or matched by Student ID appear here."
          />
        ) : (
          <DataTable
            rows={gradedPapers}
            columns={paperColumns}
            rowKey={(item) => item.paper.id}
            renderActions={(item) =>
              item.paper.needsReview ? (
                <Link
                  href={`/review?quiz_id=${item.quiz.id}&paper_id=${item.paper.id}`}
                  className="rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                >
                  Review
                </Link>
              ) : (
                <Link
                  href={`/quizzes/${item.quiz.id}`}
                  className="rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                >
                  Open quiz
                </Link>
              )
            }
          />
        )}
      </div>

      <StudentFormDrawer
        key={`profile-${student.id}-${student.sectionIds.join(",")}-${student.firstName}-${student.lastName}`}
        open={drawerOpen}
        student={student}
        sections={allClasses}
        defaultSectionId=""
        onSaved={async () => {
          setDrawerOpen(false);
          await loadData();
        }}
        onDeleted={() => {
          setDrawerOpen(false);
          router.push("/students");
        }}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
