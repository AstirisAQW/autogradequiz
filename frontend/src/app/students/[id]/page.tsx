"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StudentFormDrawer } from "@/components/roster/StudentFormDrawer";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocumentIcon, UsersIcon, WarningIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/lib/api";
import { formatHumanDate } from "@/lib/format";
import { formatPointsValue } from "@/lib/scoring";
import {
  deleteStudent,
  getRoster,
  getStudentDetail,
  type ClassWithCount,
  type StudentDetail,
  type StudentGradedPaperItem,
} from "@/lib/workspace";

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { push: pushToast } = useToast();
  const studentId = params.id;

  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [allClasses, setAllClasses] = useState<ClassWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadStudentDetail = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
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
      setAllClasses(roster.classes);
      setNotFound(false);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load student."));
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadStudentDetail();
    });
    return () => {
      active = false;
    };
  }, [loadStudentDetail]);

  async function handleConfirmDelete() {
    if (!detail || deleting) return;
    setDeleting(true);
    try {
      const fullName = `${detail.student.lastName}, ${detail.student.firstName}`;
      await deleteStudent(detail.student.id);
      setDeleteOpen(false);
      pushToast(`Deleted "${fullName}".`, "success");
      router.push("/students");
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not delete student."), "error");
      setDeleting(false);
    }
  }

  if (loading && !detail) {
    return (
      <div className="space-y-6">
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (loadError && !detail) {
    return (
      <div className="space-y-4">
        <Breadcrumb
          items={[
            { label: "Students", href: "/students" },
            { label: "Error" },
          ]}
        />
        <EmptyState
          icon={<WarningIcon />}
          title="Could not load student"
          description={loadError}
          nextStep="Confirm the backend server is running and try again."
          action={
            <Button variant="primary" onClick={() => void loadStudentDetail()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="space-y-4">
        <Breadcrumb
          items={[
            { label: "Students", href: "/students" },
            { label: "Not found" },
          ]}
        />
        <EmptyState
          icon={<UsersIcon />}
          title="Student not found"
          description="This student does not exist in this folder."
          nextStep="Return to Students to open or create a student."
          action={
            <Link href="/students">
              <Button variant="primary">All students</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const { student, classes, gradedPapers } = detail;

  const paperColumns: DataTableColumn<StudentGradedPaperItem>[] = [
    {
      key: "quiz",
      header: "Quiz",
      render: (item) => (
        <Link
          href={`/quizzes/${item.quiz.id}`}
          className="font-semibold text-[var(--text-primary)] hover:text-[var(--brand-text)] hover:underline"
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
          {formatHumanDate(
            item.paper.dateText || item.quiz.date || item.paper.createdAt,
          )}
        </span>
      ),
    },
    {
      key: "keyVersion",
      header: "Key",
      render: (item) => (
        <span className="font-medium tabular-nums">
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
            ? (item.earnedPoints / item.totalPoints) * 100
            : 0;
        return (
          <span className="tabular-nums">
            <span className="font-bold text-[var(--text-primary)]">
              {formatPointsValue(item.earnedPoints)} /{" "}
              {formatPointsValue(item.totalPoints)} pts
            </span>{" "}
            <span className="text-[0.8125rem] text-[var(--text-secondary)]">
              ({pct.toFixed(1)}%)
            </span>
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (item) =>
        item.paper.needsReview ? (
          <span className="text-[0.8125rem] font-medium text-[var(--warning-text)]">
            Needs review
          </span>
        ) : (
          <span className="text-[0.8125rem] font-medium text-[var(--success-text)]">
            Confirmed
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumb
          items={[
            { label: "Students", href: "/students" },
            { label: `${student.lastName}, ${student.firstName}` },
          ]}
        />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1>
              {student.firstName} {student.lastName}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-[var(--text-secondary)]">
              <span className="tabular-nums">
                Student ID {student.studentCode}
              </span>
              {student.externalRef && (
                <span className="tabular-nums">LRN {student.externalRef}</span>
              )}
              {classes.length === 0 ? (
                <span className="text-[var(--text-muted)]">Unassigned</span>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {classes.map((cls) => (
                    <Link
                      key={cls.id}
                      href={`/classes/${cls.id}`}
                      className="rounded-md bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--brand-subtle)] hover:text-[var(--brand-text)]"
                    >
                      {cls.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={() => setDrawerOpen(true)}>
              Edit student
            </Button>
            <ActionMenu
              label="More student actions"
              items={[
                {
                  id: "delete",
                  label: "Delete student",
                  variant: "danger",
                  onClick: () => setDeleteOpen(true),
                },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2>Graded quizzes ({gradedPapers.length})</h2>

        {gradedPapers.length === 0 ? (
          <EmptyState
            icon={<DocumentIcon />}
            title="No graded papers yet"
            description={`Papers matching Student ID ${student.studentCode} appear here automatically.`}
            nextStep="Open a quiz and upload scanned sheets to grade this student."
          />
        ) : (
          <DataTable
            rows={gradedPapers}
            columns={paperColumns}
            rowKey={(item) => item.paper.id}
            actionsHeaderSrOnly
            onRowClick={(item) => {
              if (item.paper.needsReview) {
                router.push(
                  `/review?quiz_id=${item.quiz.id}&paper_id=${item.paper.id}`,
                );
              } else {
                router.push(
                  `/quizzes/${item.quiz.id}?paper_id=${encodeURIComponent(item.paper.id)}`,
                );
              }
            }}
            renderActions={(item) =>
              item.paper.needsReview ? (
                <Link
                  href={`/review?quiz_id=${item.quiz.id}&paper_id=${item.paper.id}`}
                  className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)] [@media(pointer:coarse)]:min-h-12"
                >
                  Review
                </Link>
              ) : (
                <ActionMenu
                  label={`Actions for ${item.quiz.name}`}
                  items={[
                    {
                      id: "open-quiz",
                      label: "Inspect paper",
                      href: `/quizzes/${item.quiz.id}?paper_id=${encodeURIComponent(item.paper.id)}`,
                    },
                  ]}
                />
              )
            }
          />
        )}
      </div>

      <StudentFormDrawer
        key={drawerOpen ? `profile-${student.id}` : "profile-closed"}
        open={drawerOpen}
        student={student}
        classes={allClasses}
        defaultClassId=""
        onSaved={async () => {
          setDrawerOpen(false);
          await loadStudentDetail();
        }}
        onClose={() => setDrawerOpen(false)}
      />

      <Dialog
        open={deleteOpen}
        title={`Delete student "${student.lastName}, ${student.firstName}"?`}
        description="Removes this student from the directory and unlinks their graded papers."
        confirmLabel="Delete student"
        confirmVariant="danger"
        busy={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
