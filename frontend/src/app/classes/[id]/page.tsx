"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AddStudentPickerDialog,
  DeleteSectionDialog,
  EditSectionDialog,
} from "@/components/roster/SectionModals";
import { StudentFormDrawer } from "@/components/roster/StudentFormDrawer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { DocumentIcon, UsersIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import {
  generateUniqueStudentCode,
  getClassDetail,
  getRoster,
  saveStudent,
  type ClassDetail,
  type QuizSummary,
  type SectionWithCount,
  type Student,
} from "@/lib/workspace";

type DetailTab = "students" | "quizzes";
type StudentSortBy = "lastName" | "firstName" | "studentCode";

export default function ClassDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { push: pushToast } = useToast();
  const classId = params.id;

  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [allClasses, setAllClasses] = useState<SectionWithCount[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [activeTab, setActiveTab] = useState<DetailTab>("students");
  const [sortBy, setSortBy] = useState<StudentSortBy>("lastName");
  const [search, setSearch] = useState("");
  const [updatingStudentId, setUpdatingStudentId] = useState<string | null>(
    null,
  );

  const [editClassOpen, setEditClassOpen] = useState(false);
  const [deleteClassOpen, setDeleteClassOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [suggestedCode, setSuggestedCode] = useState("");
  const [drawerNonce, setDrawerNonce] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [classData, roster] = await Promise.all([
        getClassDetail(classId),
        getRoster(),
      ]);
      if (!classData) {
        setDetail(null);
        setNotFound(true);
        return;
      }
      setDetail(classData);
      setAllClasses(roster.sections);
      setAllStudents(roster.students);
      setNotFound(false);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  const classById = useMemo(
    () => new Map(allClasses.map((s) => [s.id, s])),
    [allClasses],
  );

  const filteredStudents = useMemo(() => {
    if (!detail) return [];
    const q = search.trim().toLowerCase();
    return detail.students
      .filter((stu) => {
        if (!q) return true;
        return (
          stu.firstName.toLowerCase().includes(q) ||
          stu.lastName.toLowerCase().includes(q) ||
          stu.studentCode.toLowerCase().includes(q) ||
          stu.externalRef.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a[sortBy].localeCompare(b[sortBy]));
  }, [detail, search, sortBy]);

  function openNewStudentDrawer() {
    setEditingStudent(null);
    setSuggestedCode(generateUniqueStudentCode(allStudents));
    setDrawerNonce((n) => n + 1);
    setDrawerOpen(true);
  }

  function openEditStudentDrawer(stu: Student) {
    setEditingStudent(stu);
    setSuggestedCode("");
    setDrawerOpen(true);
  }

  async function handleRemoveStudentFromClass(stu: Student) {
    if (!detail || updatingStudentId !== null) return;
    const classSection = detail.section;
    const previousSectionIds = [...stu.sectionIds];
    setUpdatingStudentId(stu.id);
    try {
      await saveStudent({
        id: stu.id,
        studentCode: stu.studentCode,
        firstName: stu.firstName,
        lastName: stu.lastName,
        externalRef: stu.externalRef,
        sectionIds: stu.sectionIds.filter((id) => id !== classSection.id),
      });
      await loadData();
      pushToast(
        `Removed ${stu.firstName} ${stu.lastName} from ${classSection.name}.`,
        "info",
        {
          actionLabel: "Undo",
          onAction: async () => {
            try {
              await saveStudent({
                id: stu.id,
                studentCode: stu.studentCode,
                firstName: stu.firstName,
                lastName: stu.lastName,
                externalRef: stu.externalRef,
                sectionIds: previousSectionIds,
              });
              await loadData();
              pushToast(
                `Restored ${stu.firstName} ${stu.lastName} to ${classSection.name}.`,
                "success",
              );
            } catch (err) {
              pushToast(
                err instanceof Error
                  ? err.message
                  : "Could not restore student to class.",
                "error",
              );
            }
          },
        },
      );
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not remove student.",
        "error",
      );
    } finally {
      setUpdatingStudentId(null);
    }
  }

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
          href="/classes"
          className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          ← Back to classes
        </Link>
        <EmptyState
          icon={<UsersIcon />}
          title="Class not found"
          description="This class does not exist in the local workspace."
          action={
            <Link
              href="/classes"
              className="inline-flex rounded-[8px] bg-[var(--brand)] px-3.5 py-2 text-[14px] font-medium text-white hover:bg-[var(--brand-hover)]"
            >
              View all classes
            </Link>
          }
        />
      </div>
    );
  }

  const cls = detail.section;

  const studentColumns: DataTableColumn<Student>[] = [
    {
      key: "name",
      header: "Student",
      render: (stu) => (
        <Link
          href={`/students/${stu.id}`}
          className="font-medium text-[var(--text-primary)] hover:text-[var(--brand-text)] hover:underline"
        >
          {stu.lastName}, {stu.firstName}
        </Link>
      ),
    },
    {
      key: "studentCode",
      header: "Student ID",
      render: (stu) => (
        <span className="font-mono text-[13px] tabular-nums">
          {stu.studentCode}
        </span>
      ),
    },
    {
      key: "externalRef",
      header: "External Ref",
      render: (stu) => (
        <span className="text-[var(--text-secondary)]">
          {stu.externalRef || "—"}
        </span>
      ),
    },
    {
      key: "otherClasses",
      header: "Other classes",
      render: (stu) => {
        const others = stu.sectionIds
          .filter((id) => id !== cls.id)
          .map((id) => classById.get(id))
          .filter((s): s is SectionWithCount => s !== undefined);
        if (others.length === 0) {
          return <span className="text-[var(--text-muted)]">—</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {others.map((other) => (
              <Link
                key={other.id}
                href={`/classes/${other.id}`}
                className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--brand-text)]"
              >
                {other.name}
              </Link>
            ))}
          </div>
        );
      },
    },
  ];

  const quizColumns: DataTableColumn<QuizSummary>[] = [
    {
      key: "name",
      header: "Quiz",
      render: (q) => (
        <div>
          <Link
            href={`/quizzes/${q.id}`}
            className="font-medium text-[var(--text-primary)] hover:text-[var(--brand-text)] hover:underline"
          >
            {q.name}
          </Link>
          {(q.tags?.length ?? 0) > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {(q.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[var(--border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "format",
      header: "Format",
      render: (q) => (
        <span className="text-[var(--text-secondary)]">
          {q.answerKey.length}Q · A4
        </span>
      ),
    },
    {
      key: "papers",
      header: "Papers",
      align: "right",
      render: (q) => (
        <span className="font-mono tabular-nums">{q.paperCount}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (q) =>
        q.needsReviewCount > 0 ? (
          <Badge variant="warning">{q.needsReviewCount} need review</Badge>
        ) : (
          <Badge variant="success">Clear</Badge>
        ),
    },
    {
      key: "date",
      header: "Date",
      render: (q) => (
        <span className="text-[var(--text-secondary)] tabular-nums">
          {q.date || formatDate(q.createdAt)}
        </span>
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
          <Link href="/classes" className="hover:text-[var(--text-primary)]">
            ← Classes
          </Link>{" "}
          <span className="text-[var(--text-muted)]">/</span>{" "}
          <span className="text-[var(--text-primary)]">{cls.name}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1>{cls.name}</h1>
            <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
              {cls.term ? `${cls.term} · ` : ""}Created {formatDate(cls.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setEditClassOpen(true)}
            >
              Edit class
            </Button>
            <Button variant="ghost" onClick={() => setDeleteClassOpen(true)}>
              Delete
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Students" value={detail.students.length} />
        <StatCard label="Assigned Quizzes" value={detail.quizzes.length} />
        <StatCard label="Term" value={cls.term || "—"} />
      </div>

      <Tabs<DetailTab>
        activeId={activeTab}
        onChange={setActiveTab}
        items={[
          { id: "students", label: "Students", count: detail.students.length },
          { id: "quizzes", label: "Quizzes", count: detail.quizzes.length },
        ]}
      />

      {activeTab === "students" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-[170px]">
                <FormField id="class-student-sort" label="Sort by">
                  <SelectInput
                    id="class-student-sort"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as StudentSortBy)}
                  >
                    <option value="lastName">Last name</option>
                    <option value="firstName">First name</option>
                    <option value="studentCode">Student ID</option>
                  </SelectInput>
                </FormField>
              </div>
              <div className="min-w-[220px]">
                <FormField id="class-student-search" label="Search">
                  <TextInput
                    id="class-student-search"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter enrolled students…"
                  />
                </FormField>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setPickerOpen(true)}
                disabled={allStudents.length === 0}
                disabledReason="No students in directory yet"
              >
                Add existing students
              </Button>
              <Button variant="primary" onClick={openNewStudentDrawer}>
                + New student
              </Button>
            </div>
          </div>

          {detail.students.length === 0 ? (
            <EmptyState
              icon={<UsersIcon />}
              title={`No students in ${cls.name} yet`}
              description="Add a new student directly or enroll existing students from the directory."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={openNewStudentDrawer}>
                    + New student
                  </Button>
                  {allStudents.length > 0 && (
                    <Button
                      variant="secondary"
                      onClick={() => setPickerOpen(true)}
                    >
                      Add existing students
                    </Button>
                  )}
                </div>
              }
            />
          ) : filteredStudents.length === 0 ? (
            <EmptyState
              icon={<UsersIcon />}
              title="No matching students"
              description="Clear the search filter to see enrolled students."
              action={
                <Button variant="secondary" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <DataTable
              rows={filteredStudents}
              columns={studentColumns}
              rowKey={(stu) => stu.id}
              renderActions={(stu) => (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openEditStudentDrawer(stu)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleRemoveStudentFromClass(stu)}
                    disabled={updatingStudentId === stu.id}
                  >
                    Remove
                  </Button>
                </>
              )}
            />
          )}
        </div>
      ) : detail.quizzes.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title={`No quizzes assigned to ${cls.name}`}
          description="Assign this class when creating or editing a quiz on the Quizzes page."
          action={
            <Link
              href="/"
              className="inline-flex rounded-[8px] bg-[var(--brand)] px-3.5 py-2 text-[14px] font-medium text-white hover:bg-[var(--brand-hover)]"
            >
              Go to Quizzes
            </Link>
          }
        />
      ) : (
        <DataTable
          rows={detail.quizzes}
          columns={quizColumns}
          rowKey={(q) => q.id}
          renderActions={(q) => (
            <Link
              href={`/quizzes/${q.id}`}
              className="rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
            >
              Open quiz
            </Link>
          )}
        />
      )}

      <StudentFormDrawer
        key={
          editingStudent
            ? `edit-${editingStudent.id}-${editingStudent.sectionIds.join(",")}`
            : `new-${cls.id}-${drawerNonce}`
        }
        open={drawerOpen}
        student={editingStudent}
        sections={allClasses}
        defaultSectionId={cls.id}
        suggestedStudentCode={editingStudent ? "" : suggestedCode}
        onSaved={async () => {
          setDrawerOpen(false);
          await loadData();
        }}
        onDeleted={() => {
          setDrawerOpen(false);
          void loadData();
        }}
        onClose={() => setDrawerOpen(false)}
      />

      <AddStudentPickerDialog
        key={pickerOpen ? `picker-${cls.id}-open` : "picker-closed"}
        open={pickerOpen}
        section={cls}
        students={allStudents}
        onUpdated={async () => {
          setPickerOpen(false);
          await loadData();
        }}
        onCreateNewInSection={() => {
          setPickerOpen(false);
          openNewStudentDrawer();
        }}
        onClose={() => setPickerOpen(false)}
      />

      <EditSectionDialog
        key={`edit-cls-${cls.id}-${cls.name}-${cls.term}`}
        open={editClassOpen}
        section={cls}
        onSaved={async () => {
          setEditClassOpen(false);
          await loadData();
        }}
        onClose={() => setEditClassOpen(false)}
      />

      <DeleteSectionDialog
        open={deleteClassOpen}
        section={cls}
        onDeleted={async () => {
          setDeleteClassOpen(false);
          router.push("/classes");
        }}
        onClose={() => setDeleteClassOpen(false)}
      />
    </div>
  );
}
