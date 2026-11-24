"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StudentFormDrawer } from "@/components/roster/StudentFormDrawer";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { UsersIcon, WarningIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/lib/api";
import { parseRosterCsv } from "@/lib/rosterCsv";
import {
  deleteStudent,
  generateUniqueStudentCode,
  getRoster,
  importStudents,
  type ClassWithCount,
  type Student,
} from "@/lib/workspace";

type SortBy = "lastName" | "firstName" | "studentCode";

export default function StudentsPage() {
  const router = useRouter();
  const { push: pushToast } = useToast();

  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<SortBy>("lastName");
  const [classFilterId, setClassFilterId] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [suggestedCode, setSuggestedCode] = useState("");
  const [drawerNonce, setDrawerNonce] = useState(0);

  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const loadStudentsPage = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    let initialClass = "";
    try {
      const params = new URLSearchParams(window.location.search);
      initialClass = params.get("class_id") ?? "";
    } catch {
      initialClass = "";
    }
    try {
      const roster = await getRoster();
      setStudents(roster.students);
      setClasses(roster.classes);
      if (initialClass && roster.classes.some((c) => c.id === initialClass)) {
        setClassFilterId(initialClass);
      }
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load students."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadStudentsPage();
    });
    return () => {
      active = false;
    };
  }, [loadStudentsPage]);

  const classById = useMemo(
    () => new Map(classes.map((c) => [c.id, c])),
    [classes],
  );

  const sortedClasses = useMemo(
    () => [...classes].sort((a, b) => a.name.localeCompare(b.name)),
    [classes],
  );

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students
      .filter((stu) => {
        if (classFilterId === "unassigned") {
          if (stu.classIds.length > 0) return false;
        } else if (classFilterId !== "all") {
          if (!stu.classIds.includes(classFilterId)) return false;
        }
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
  }, [students, classFilterId, search, sortBy]);

  function openNewDrawer() {
    setEditing(null);
    setSuggestedCode(generateUniqueStudentCode(students));
    setDrawerNonce((n) => n + 1);
    setDrawerOpen(true);
  }

  function openEditDrawer(stu: Student) {
    setEditing(stu);
    setSuggestedCode("");
    setDrawerOpen(true);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const fullName = `${deleteTarget.lastName}, ${deleteTarget.firstName}`;
      await deleteStudent(deleteTarget.id);
      setDeleteTarget(null);
      await loadStudentsPage();
      pushToast(`Deleted student "${fullName}".`, "success");
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not delete student."), "error");
    } finally {
      setDeleting(false);
    }
  }

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (importInputRef.current) importInputRef.current.value = "";
    if (!file || importingCsv) return;

    setImportingCsv(true);
    try {
      const text = await file.text();
      const parsed = parseRosterCsv(text);
      if (parsed.rows.length === 0) {
        pushToast(
          "No valid student rows found. Include Name (or First/Last Name) columns.",
          "error",
        );
        return;
      }

      const result = await importStudents(parsed.rows);
      const totalSkipped = parsed.skipped + result.skipped;
      await loadStudentsPage();
      pushToast(
        totalSkipped > 0
          ? `Imported ${result.imported} ${result.imported === 1 ? "student" : "students"} (${totalSkipped} skipped).`
          : `Imported ${result.imported} ${result.imported === 1 ? "student" : "students"}.`,
        "success",
      );
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not import CSV."), "error");
    } finally {
      setImportingCsv(false);
    }
  }

  const filtersActive = Boolean(search.trim() || classFilterId !== "all");
  const showFilters = students.length >= 5 || filtersActive;

  const columns: DataTableColumn<Student>[] = [
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
      key: "classes",
      header: "Class",
      render: (stu) => {
        const names = stu.classIds
          .map((id) => classById.get(id)?.name)
          .filter((name): name is string => Boolean(name))
          .join(", ");
        return (
          <span
            className={
              names ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
            }
          >
            {names || "Unassigned"}
          </span>
        );
      },
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
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1>Students</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void handleCsvImport(e)}
            className="sr-only"
          />
          <Button
            variant="secondary"
            disabled={importingCsv}
            onClick={() => importInputRef.current?.click()}
          >
            {importingCsv ? "Importing..." : "Import CSV"}
          </Button>
          <Button variant="primary" onClick={openNewDrawer}>
            New student
          </Button>
        </div>
      </div>

      {!loading && !loadError && students.length >= 2 && (
        <p className="text-sm text-[var(--text-primary)] tabular-nums">
          {students.length} {students.length === 1 ? "student" : "students"} in{" "}
          {classes.length} {classes.length === 1 ? "class" : "classes"}.
        </p>
      )}

      {showFilters && students.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-3">
          <FormField
            id="students-search"
            label="Search students"
            size="sm"
            className="min-w-[200px] flex-1"
          >
            <TextInput
              id="students-search"
              type="search"
              inputSize="sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, Student ID, or LRN"
            />
          </FormField>

          <FormField id="students-class-filter" label="Class" size="sm">
            <SelectInput
              id="students-class-filter"
              selectSize="sm"
              value={classFilterId}
              onChange={(e) => setClassFilterId(e.target.value)}
              className="!w-auto min-w-[150px]"
            >
              <option value="all">All classes ({students.length})</option>
              <option value="unassigned">Unassigned</option>
              {sortedClasses.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name} ({cls.studentCount})
                </option>
              ))}
            </SelectInput>
          </FormField>

          <FormField id="students-sort" label="Sort by" size="sm">
            <SelectInput
              id="students-sort"
              selectSize="sm"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="!w-auto min-w-[130px]"
            >
              <option value="lastName">Last name</option>
              <option value="firstName">First name</option>
              <option value="studentCode">Student ID</option>
            </SelectInput>
          </FormField>
        </div>
      )}

      {loadError ? (
        <EmptyState
          tone="error"
          icon={<WarningIcon />}
          title="Could not load students"
          description={loadError}
          nextStep="Make sure the backend is running, then select Try again."
          action={
            <Button variant="primary" onClick={() => void loadStudentsPage()}>
              Try again
            </Button>
          }
        />
      ) : loading ? (
        <SkeletonRows rows={5} />
      ) : students.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title="No students yet"
          description="Add students so uploaded papers link automatically by Student ID."
          nextStep="Select New student above to add your first student."
          action={
            <Button variant="primary" onClick={openNewDrawer}>
              New student
            </Button>
          }
        />
      ) : filteredStudents.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title="No matching students"
          description="No student records matched your current search or class filter."
          nextStep={`Clear your filters to show all ${students.length} students.`}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch("");
                setClassFilterId("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={filteredStudents}
          columns={columns}
          rowKey={(stu) => stu.id}
          actionsHeaderSrOnly
          onRowClick={(stu) => router.push(`/students/${stu.id}`)}
          renderActions={(stu) => (
            <ActionMenu
              label={`Actions for ${stu.lastName}, ${stu.firstName}`}
              items={[
                {
                  id: "open",
                  label: "Open profile",
                  href: `/students/${stu.id}`,
                },
                {
                  id: "edit",
                  label: "Edit student",
                  onClick: () => openEditDrawer(stu),
                },
                { kind: "divider", id: "div-1" },
                {
                  id: "delete",
                  label: "Delete student",
                  variant: "danger",
                  onClick: () => setDeleteTarget(stu),
                },
              ]}
            />
          )}
        />
      )}

      <StudentFormDrawer
        key={
          drawerOpen
            ? editing
              ? `edit-${editing.id}`
              : `new-${drawerNonce}`
            : "student-drawer-closed"
        }
        open={drawerOpen}
        student={editing}
        classes={classes}
        defaultClassId={
          classFilterId !== "all" && classFilterId !== "unassigned"
            ? classFilterId
            : ""
        }
        suggestedStudentCode={editing ? "" : suggestedCode}
        onSaved={async () => {
          setDrawerOpen(false);
          await loadStudentsPage();
        }}
        onClose={() => setDrawerOpen(false)}
      />

      <Dialog
        open={deleteTarget !== null}
        title={`Delete student "${deleteTarget?.lastName ?? ""}, ${deleteTarget?.firstName ?? ""}"?`}
        description="Removes this student from the directory and unlinks their graded papers."
        confirmLabel="Delete student"
        confirmVariant="danger"
        busy={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
