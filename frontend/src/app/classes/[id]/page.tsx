"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AddStudentPickerDialog,
  DeleteClassDialog,
  EditClassDialog,
} from "@/components/roster/ClassModals";
import { StudentFormDrawer } from "@/components/roster/StudentFormDrawer";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { DocumentIcon, UsersIcon, WarningIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/lib/api";
import { formatHumanDate } from "@/lib/format";
import {
  generateUniqueStudentCode,
  getClassDetail,
  getRoster,
  saveStudent,
  type ClassDetail,
  type ClassWithCount,
  type QuizSummary,
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
  const [allClasses, setAllClasses] = useState<ClassWithCount[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  const loadClassDetail = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
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
      setAllClasses(roster.classes);
      setAllStudents(roster.students);
      setNotFound(false);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load class."));
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadClassDetail();
    });
    return () => {
      active = false;
    };
  }, [loadClassDetail]);

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
      .sort(
        (a, b) =>
          a[sortBy].localeCompare(b[sortBy], undefined, {
            numeric: true,
            sensitivity: "base",
          }) ||
          a.lastName.localeCompare(b.lastName, undefined, {
            sensitivity: "base",
          }) ||
          a.firstName.localeCompare(b.firstName, undefined, {
            sensitivity: "base",
          }) ||
          a.studentCode.localeCompare(b.studentCode, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
      );
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
    const targetClass = detail.class;
    const previousClassIds = [...stu.classIds];
    setUpdatingStudentId(stu.id);
    try {
      await saveStudent({
        id: stu.id,
        studentCode: stu.studentCode,
        firstName: stu.firstName,
        lastName: stu.lastName,
        externalRef: stu.externalRef,
        classIds: stu.classIds.filter((id) => id !== targetClass.id),
      });
      await loadClassDetail();
      pushToast(
        `Removed ${stu.firstName} ${stu.lastName} from ${targetClass.name}.`,
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
                classIds: previousClassIds,
              });
              await loadClassDetail();
              pushToast(
                `Restored ${stu.firstName} ${stu.lastName} to ${targetClass.name}.`,
                "success",
              );
            } catch (err) {
              pushToast(
                getErrorMessage(err, "Could not restore student to class."),
                "error",
              );
            }
          },
        },
      );
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not remove student."), "error");
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

  if (loadError && !detail) {
    return (
      <div className="space-y-4">
        <Breadcrumb
          items={[{ label: "Classes", href: "/classes" }, { label: "Error" }]}
        />
        <EmptyState
          icon={<WarningIcon />}
          title="Could not load class"
          description={loadError}
          nextStep="Confirm the backend server is running and try again."
          action={
            <Button variant="primary" onClick={() => void loadClassDetail()}>
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
          items={[{ label: "Classes", href: "/classes" }, { label: "Not found" }]}
        />
        <EmptyState
          icon={<UsersIcon />}
          title="Class not found"
          description="This class does not exist in this folder."
          nextStep="Return to Classes to open or create a class."
          action={
            <Link href="/classes">
              <Button variant="primary">All classes</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const cls = detail.class;
  const showStudentFilters = detail.students.length >= 5 || Boolean(search.trim());
  const hasUnenrolledStudents = allStudents.some(
    (stu) => !stu.classIds.includes(cls.id),
  );

  const studentColumns: DataTableColumn<Student>[] = [
    {
      key: "name",
      header: "Name",
      render: (stu) => (
        <Link
          href={`/students/${stu.id}`}
          className="font-semibold text-[var(--text-primary)] hover:text-[var(--brand-text)] hover:underline"
        >
          {stu.lastName}, {stu.firstName}
        </Link>
      ),
    },
    {
      key: "studentCode",
      header: "Student ID",
      render: (stu) => (
        <span className="tabular-nums">{stu.studentCode}</span>
      ),
    },
    {
      key: "externalRef",
      header: "LRN",
      render: (stu) => (
        <span className="text-[var(--text-secondary)] tabular-nums">
          {stu.externalRef || "—"}
        </span>
      ),
    },
    {
      key: "otherClasses",
      header: "Other classes",
      render: (stu) => {
        const others = stu.classIds
          .filter((id) => id !== cls.id)
          .map((id) => classById.get(id))
          .filter((s): s is ClassWithCount => s !== undefined);
        if (others.length === 0) {
          return <span className="text-[var(--text-muted)]">—</span>;
        }
        return others.map((other) => other.name).join(", ");
      },
    },
  ];

  const quizColumns: DataTableColumn<QuizSummary>[] = [
    {
      key: "name",
      header: "Quiz",
      render: (q) => (
        <Link
          href={`/quizzes/${q.id}`}
          className="font-semibold text-[var(--text-primary)] hover:text-[var(--brand-text)] hover:underline"
        >
          {q.name}
        </Link>
      ),
    },
    {
      key: "format",
      header: "Format",
      render: (q) => (
        <span className="text-[var(--text-secondary)] tabular-nums">
          {q.answerKey.length} questions, A4 form
        </span>
      ),
    },
    {
      key: "papers",
      header: "Papers",
      align: "right",
      render: (q) => (
        <span className="font-semibold tabular-nums">{q.paperCount}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (q) =>
        q.answerKey.some((a) => !a) ? (
          <span className="text-[0.8125rem] font-medium text-[var(--warning-text)]">
            Key not set
          </span>
        ) : q.needsReviewCount > 0 ? (
          <span className="text-[0.8125rem] font-medium text-[var(--warning-text)] tabular-nums">
            {q.needsReviewCount}{" "}
            {q.needsReviewCount === 1 ? "needs review" : "need review"}
          </span>
        ) : (
          <span className="text-[0.8125rem] font-medium text-[var(--success-text)]">
            Confirmed
          </span>
        ),
    },
    {
      key: "date",
      header: "Date",
      render: (q) => (
        <span className="text-[var(--text-secondary)] tabular-nums">
          {formatHumanDate(q.date || q.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumb
          items={[{ label: "Classes", href: "/classes" }, { label: cls.name }]}
        />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1>{cls.name}</h1>
            {cls.term && (
              <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                Term: {cls.term}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasUnenrolledStudents && (
              <Button variant="secondary" onClick={() => setPickerOpen(true)}>
                Add existing students
              </Button>
            )}
            <Button variant="primary" onClick={openNewStudentDrawer}>
              New student
            </Button>
            <ActionMenu
              label="More class actions"
              items={[
                {
                  id: "edit",
                  label: "Edit class",
                  onClick: () => setEditClassOpen(true),
                },
                { kind: "divider", id: "div-1" },
                {
                  id: "delete",
                  label: "Delete class",
                  variant: "danger",
                  onClick: () => setDeleteClassOpen(true),
                },
              ]}
            />
          </div>
        </div>
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
          {showStudentFilters && detail.students.length > 0 && (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-3">
              <FormField
                id="class-student-search"
                label="Search students"
                size="sm"
                className="min-w-[200px] flex-1"
              >
                <TextInput
                  id="class-student-search"
                  type="search"
                  inputSize="sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, Student ID, or LRN"
                />
              </FormField>
              <FormField id="class-student-sort" label="Sort by" size="sm">
                <SelectInput
                  id="class-student-sort"
                  selectSize="sm"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as StudentSortBy)}
                  className="!w-auto min-w-[140px]"
                >
                  <option value="lastName">Last name</option>
                  <option value="firstName">First name</option>
                  <option value="studentCode">Student ID</option>
                </SelectInput>
              </FormField>
            </div>
          )}

          {detail.students.length === 0 ? (
            <EmptyState
              icon={<UsersIcon />}
              title={`No students in ${cls.name}`}
              description="This class currently has no enrolled students."
              nextStep={`Select New student above to add a student to ${cls.name}.`}
            />
          ) : filteredStudents.length === 0 ? (
            <EmptyState
              icon={<UsersIcon />}
              title="No matching students"
              description="No enrolled students matched your search."
              nextStep="Clear the search filter to show enrolled students."
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
              actionsHeaderSrOnly
              onRowClick={(stu) => router.push(`/students/${stu.id}`)}
              renderActions={(stu) => (
                <ActionMenu
                  label={`Actions for ${stu.lastName}, ${stu.firstName}`}
                  items={[
                    {
                      id: "edit",
                      label: "Edit student",
                      onClick: () => openEditStudentDrawer(stu),
                    },
                    { kind: "divider", id: "div-1" },
                    {
                      id: "remove",
                      label:
                        updatingStudentId === stu.id
                          ? "Removing..."
                          : "Remove from class",
                      variant: "danger",
                      onClick: () => void handleRemoveStudentFromClass(stu),
                    },
                  ]}
                />
              )}
            />
          )}
        </div>
      ) : detail.quizzes.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title={`No quizzes assigned to ${cls.name}`}
          description="Quizzes assigned to this class appear here."
          nextStep="Open Quizzes to create or assign a quiz."
          action={
            <Link href="/">
              <Button variant="primary">Open quizzes</Button>
            </Link>
          }
        />
      ) : (
        <DataTable
          rows={detail.quizzes}
          columns={quizColumns}
          rowKey={(q) => q.id}
          actionsHeaderSrOnly
          onRowClick={(q) => router.push(`/quizzes/${q.id}`)}
          renderActions={(q) => (
            <ActionMenu
              label={`Actions for ${q.name}`}
              items={[
                { id: "open", label: "Open quiz", href: `/quizzes/${q.id}` },
              ]}
            />
          )}
        />
      )}

      <StudentFormDrawer
        key={
          drawerOpen
            ? editingStudent
              ? `edit-${editingStudent.id}`
              : `new-${cls.id}-${drawerNonce}`
            : "student-drawer-closed"
        }
        open={drawerOpen}
        student={editingStudent}
        classes={allClasses}
        defaultClassId={cls.id}
        suggestedStudentCode={editingStudent ? "" : suggestedCode}
        onSaved={async () => {
          setDrawerOpen(false);
          await loadClassDetail();
        }}
        onClose={() => setDrawerOpen(false)}
      />

      <AddStudentPickerDialog
        key={pickerOpen ? `picker-${cls.id}-open` : "picker-closed"}
        open={pickerOpen}
        classItem={cls}
        students={allStudents}
        onUpdated={async () => {
          setPickerOpen(false);
          await loadClassDetail();
        }}
        onCreateNewInClass={() => {
          setPickerOpen(false);
          openNewStudentDrawer();
        }}
        onClose={() => setPickerOpen(false)}
      />

      <EditClassDialog
        key={editClassOpen ? `edit-cls-${cls.id}` : "edit-cls-closed"}
        open={editClassOpen}
        classItem={cls}
        onSaved={async () => {
          setEditClassOpen(false);
          await loadClassDetail();
        }}
        onClose={() => setEditClassOpen(false)}
      />

      <DeleteClassDialog
        open={deleteClassOpen}
        classItem={cls}
        onDeleted={async () => {
          setDeleteClassOpen(false);
          router.push("/classes");
        }}
        onClose={() => setDeleteClassOpen(false)}
      />
    </div>
  );
}
