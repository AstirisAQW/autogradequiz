"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DeleteClassDialog,
  EditClassDialog,
  InlineNewClassCard,
} from "@/components/roster/ClassModals";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { UsersIcon, WarningIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { getErrorMessage } from "@/lib/api";
import {
  listClassSummaries,
  type ClassSummary,
} from "@/lib/workspace";

type ClassSortBy = "name" | "students" | "quizzes";

export default function ClassesPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<ClassSortBy>("name");

  const [creatingOpen, setCreatingOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassSummary | null>(null);
  const [deletingClass, setDeletingClass] = useState<ClassSummary | null>(null);

  const loadClassesPage = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listClassSummaries();
      setClasses(data);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load classes."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadClassesPage();
    });
    return () => {
      active = false;
    };
  }, [loadClassesPage]);

  const filteredClasses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return classes
      .filter((cls) => {
        if (!q) return true;
        return (
          cls.name.toLowerCase().includes(q) ||
          cls.term.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortBy === "students") return b.studentCount - a.studentCount;
        if (sortBy === "quizzes") return b.quizCount - a.quizCount;
        return a.name.localeCompare(b.name);
      });
  }, [classes, search, sortBy]);

  const showFilters = classes.length >= 5 || Boolean(search.trim());
  const totalStudents = classes.reduce((sum, cls) => sum + cls.studentCount, 0);

  const columns: DataTableColumn<ClassSummary>[] = [
    {
      key: "name",
      header: "Class",
      render: (cls) => (
        <div>
          <Link
            href={`/classes/${cls.id}`}
            className="font-semibold text-[var(--text-primary)] hover:text-[var(--brand-text)] hover:underline"
          >
            {cls.name}
          </Link>
          {cls.term && (
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Term: {cls.term}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "students",
      header: "Students",
      align: "right",
      render: (cls) => (
        <span className="font-semibold tabular-nums">{cls.studentCount}</span>
      ),
    },
    {
      key: "quizzes",
      header: "Quizzes",
      align: "right",
      render: (cls) => (
        <span className="font-semibold tabular-nums">{cls.quizCount}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1>Classes</h1>
        <Button
          variant="primary"
          onClick={() => setCreatingOpen(true)}
          disabled={creatingOpen}
        >
          New class
        </Button>
      </div>

      {!loading && !loadError && classes.length >= 2 && (
        <p className="text-sm text-[var(--text-primary)] tabular-nums">
          {classes.length} {classes.length === 1 ? "class" : "classes"},{" "}
          {totalStudents} {totalStudents === 1 ? "student" : "students"}{" "}
          enrolled.
        </p>
      )}

      {creatingOpen && (
        <InlineNewClassCard
          onCreated={async () => {
            setCreatingOpen(false);
            await loadClassesPage();
          }}
          onCancel={() => setCreatingOpen(false)}
        />
      )}

      {showFilters && classes.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-3">
          <FormField
            id="class-search"
            label="Search classes"
            size="sm"
            className="min-w-[200px] flex-1"
          >
            <TextInput
              id="class-search"
              type="search"
              inputSize="sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by class name or term"
            />
          </FormField>
          <FormField id="class-sort" label="Sort by" size="sm">
            <SelectInput
              id="class-sort"
              selectSize="sm"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ClassSortBy)}
              className="!w-auto min-w-[140px]"
            >
              <option value="name">Class name</option>
              <option value="students">Most students</option>
              <option value="quizzes">Most quizzes</option>
            </SelectInput>
          </FormField>
        </div>
      )}

      {loadError ? (
        <EmptyState
          tone="error"
          icon={<WarningIcon />}
          title="Could not load classes"
          description={loadError}
          nextStep="Check your backend connection and select Try again."
          action={
            <Button variant="primary" onClick={() => void loadClassesPage()}>
              Try again
            </Button>
          }
        />
      ) : loading ? (
        <SkeletonRows rows={4} />
      ) : classes.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title="No classes yet"
          description="Group students and quizzes by class."
          nextStep="Select New class above to add your first class."
          action={
            <Button variant="primary" onClick={() => setCreatingOpen(true)}>
              New class
            </Button>
          }
        />
      ) : filteredClasses.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title={`No classes match "${search}"`}
          description="No class matched that name or term."
          nextStep={`Clear your search to see all ${classes.length} classes.`}
          action={
            <Button variant="secondary" onClick={() => setSearch("")}>
              Clear search
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={filteredClasses}
          columns={columns}
          rowKey={(cls) => cls.id}
          actionsHeaderSrOnly
          onRowClick={(cls) => router.push(`/classes/${cls.id}`)}
          renderActions={(cls) => (
            <ActionMenu
              label={`Actions for ${cls.name}`}
              items={[
                {
                  id: "open",
                  label: "Open class",
                  href: `/classes/${cls.id}`,
                },
                {
                  id: "edit",
                  label: "Edit class",
                  onClick: () => setEditingClass(cls),
                },
                { kind: "divider", id: "div-1" },
                {
                  id: "delete",
                  label: "Delete class",
                  variant: "danger",
                  onClick: () => setDeletingClass(cls),
                },
              ]}
            />
          )}
        />
      )}

      <EditClassDialog
        key={editingClass?.id ?? "edit-class-closed"}
        open={editingClass !== null}
        classItem={editingClass}
        onSaved={async () => {
          setEditingClass(null);
          await loadClassesPage();
        }}
        onClose={() => setEditingClass(null)}
      />

      <DeleteClassDialog
        open={deletingClass !== null}
        classItem={deletingClass}
        onDeleted={async () => {
          setDeletingClass(null);
          await loadClassesPage();
        }}
        onClose={() => setDeletingClass(null)}
      />
    </div>
  );
}
