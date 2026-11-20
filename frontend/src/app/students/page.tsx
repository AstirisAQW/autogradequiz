"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StudentFormDrawer } from "@/components/roster/StudentFormDrawer";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { UsersIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import {
  generateUniqueStudentCode,
  getRoster,
  type SectionWithCount,
  type Student,
} from "@/lib/workspace";

type SortBy = "lastName" | "firstName" | "studentCode";

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SectionWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<SortBy>("lastName");
  const [classFilterId, setClassFilterId] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [suggestedCode, setSuggestedCode] = useState("");
  const [drawerNonce, setDrawerNonce] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    let initialClass = "";
    try {
      const params = new URLSearchParams(window.location.search);
      initialClass = params.get("class_id") ?? params.get("section_id") ?? "";
    } catch {
      initialClass = "";
    }
    try {
      const roster = await getRoster();
      setStudents(roster.students);
      setClasses(roster.sections);
      if (initialClass && roster.sections.some((c) => c.id === initialClass)) {
        setClassFilterId(initialClass);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not load students.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

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
          if (stu.sectionIds.length > 0) return false;
        } else if (classFilterId !== "all") {
          if (!stu.sectionIds.includes(classFilterId)) return false;
        }
        if (!q) return true;
        return (
          stu.firstName.toLowerCase().includes(q) ||
          stu.lastName.toLowerCase().includes(q) ||
          stu.studentCode.toLowerCase().includes(q) ||
          stu.externalRef.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a[sortBy].localeCompare(b[sortBy]));
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

  const columns: DataTableColumn<Student>[] = [
    {
      key: "name",
      header: "Name",
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
      key: "classes",
      header: "Classes",
      render: (stu) => {
        const assigned = stu.sectionIds
          .map((id) => classById.get(id))
          .filter((c): c is SectionWithCount => c !== undefined);
        if (assigned.length === 0) {
          return (
            <span className="text-[12px] text-[var(--text-muted)]">
              No class
            </span>
          );
        }
        return (
          <div className="flex flex-wrap gap-1">
            {assigned.map((cls) => (
              <Link
                key={cls.id}
                href={`/classes/${cls.id}`}
                className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--brand-text)]"
              >
                {cls.name}
              </Link>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1>Students</h1>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            Student directory with auto-generated 5-digit Student IDs, class
            enrollments, and graded paper history.
          </p>
        </div>

        <Button variant="primary" onClick={openNewDrawer}>
          + New student
        </Button>
      </div>

      {students.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
          <div className="w-[170px]">
            <FormField id="students-sort" label="Sort by">
              <SelectInput
                id="students-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
              >
                <option value="lastName">Last name</option>
                <option value="firstName">First name</option>
                <option value="studentCode">Student ID</option>
              </SelectInput>
            </FormField>
          </div>

          <div className="w-[200px]">
            <FormField id="students-class-filter" label="Class">
              <SelectInput
                id="students-class-filter"
                value={classFilterId}
                onChange={(e) => setClassFilterId(e.target.value)}
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
          </div>

          <div className="min-w-[220px] flex-1">
            <FormField id="students-search" label="Search">
              <TextInput
                id="students-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, Student ID, or ref…"
              />
            </FormField>
          </div>
        </div>
      )}

      {loadError ? (
        <div className="rounded-[12px] border border-red-300 bg-[var(--danger-bg)] p-4 text-[14px] text-[var(--danger-text)]">
          <p className="font-medium">Could not load students</p>
          <p className="mt-1">{loadError}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadData()}
            className="mt-3"
          >
            Retry
          </Button>
        </div>
      ) : loading ? (
        <SkeletonRows rows={5} />
      ) : students.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title="No students yet"
          description="Add students here to link scanned answer sheets by name or Student ID."
          action={
            <Button variant="primary" onClick={openNewDrawer}>
              + New student
            </Button>
          }
        />
      ) : filteredStudents.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title="No matching students"
          description="Try clearing the search query or switching the class filter."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch("");
                setClassFilterId("all");
              }}
            >
              Reset filters
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={filteredStudents}
          columns={columns}
          rowKey={(stu) => stu.id}
          renderActions={(stu) => (
            <>
              <Link
                href={`/students/${stu.id}`}
                className="rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
              >
                View
              </Link>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openEditDrawer(stu)}
              >
                Edit
              </Button>
            </>
          )}
        />
      )}

      <StudentFormDrawer
        key={
          editing
            ? `edit-${editing.id}-${editing.sectionIds.join(",")}`
            : `new-${drawerNonce}`
        }
        open={drawerOpen}
        student={editing}
        sections={classes}
        defaultSectionId={
          classFilterId !== "all" && classFilterId !== "unassigned"
            ? classFilterId
            : ""
        }
        suggestedStudentCode={editing ? "" : suggestedCode}
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
    </div>
  );
}
