"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DeleteSectionDialog,
  EditSectionDialog,
  InlineNewSectionCard,
} from "@/components/roster/SectionModals";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { UsersIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/format";
import { listClassSummaries, type ClassSummary } from "@/lib/workspace";

type ClassSortBy = "name" | "students" | "quizzes";

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<ClassSortBy>("name");

  const [creatingOpen, setCreatingOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassSummary | null>(null);
  const [deletingClass, setDeletingClass] = useState<ClassSummary | null>(null);

  const loadClasses = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listClassSummaries();
      setClasses(data);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not load classes.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadClasses();
    });
    return () => {
      active = false;
    };
  }, [loadClasses]);

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

  const columns: DataTableColumn<ClassSummary>[] = [
    {
      key: "name",
      header: "Class",
      render: (cls) => (
        <div>
          <Link
            href={`/classes/${cls.id}`}
            className="font-medium text-[var(--text-primary)] hover:text-[var(--brand-text)] hover:underline"
          >
            {cls.name}
          </Link>
          {cls.term && (
            <p className="text-[12px] text-[var(--text-muted)]">{cls.term}</p>
          )}
        </div>
      ),
    },
    {
      key: "students",
      header: "Students",
      align: "right",
      render: (cls) => (
        <span className="font-mono tabular-nums">{cls.studentCount}</span>
      ),
    },
    {
      key: "quizzes",
      header: "Quizzes",
      align: "right",
      render: (cls) => (
        <span className="font-mono tabular-nums">{cls.quizCount}</span>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (cls) => (
        <span className="text-[var(--text-secondary)] tabular-nums">
          {formatDate(cls.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1>Classes</h1>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            Organize students and assigned quizzes into class rosters.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={() => setCreatingOpen(true)}
          disabled={creatingOpen}
        >
          + New class
        </Button>
      </div>

      {creatingOpen && (
        <InlineNewSectionCard
          onCreated={async () => {
            setCreatingOpen(false);
            await loadClasses();
          }}
          onCancel={() => setCreatingOpen(false)}
        />
      )}

      {classes.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
          <div className="min-w-[220px] flex-1">
            <FormField id="class-search" label="Search">
              <TextInput
                id="class-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search classes by name or term…"
              />
            </FormField>
          </div>
          <div className="w-[180px]">
            <FormField id="class-sort" label="Sort by">
              <SelectInput
                id="class-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as ClassSortBy)}
              >
                <option value="name">Class name</option>
                <option value="students">Most students</option>
                <option value="quizzes">Most quizzes</option>
              </SelectInput>
            </FormField>
          </div>
        </div>
      )}

      {loadError ? (
        <div className="rounded-[12px] border border-red-300 bg-[var(--danger-bg)] p-4 text-[14px] text-[var(--danger-text)]">
          <p className="font-medium">Could not load classes</p>
          <p className="mt-1">{loadError}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadClasses()}
            className="mt-3"
          >
            Retry
          </Button>
        </div>
      ) : loading ? (
        <SkeletonRows rows={4} />
      ) : classes.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title="No classes yet"
          description="Create a class to group students and track quizzes assigned to them."
          action={
            <Button variant="primary" onClick={() => setCreatingOpen(true)}>
              + New class
            </Button>
          }
        />
      ) : filteredClasses.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title="No matching classes"
          description="Try clearing or broadening your search term."
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
          renderActions={(cls) => (
            <>
              <Link
                href={`/classes/${cls.id}`}
                className="rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
              >
                Open
              </Link>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditingClass(cls)}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeletingClass(cls)}
              >
                Delete
              </Button>
            </>
          )}
        />
      )}

      <EditSectionDialog
        key={editingClass?.id ?? "edit-class-closed"}
        open={editingClass !== null}
        section={editingClass}
        onSaved={async () => {
          setEditingClass(null);
          await loadClasses();
        }}
        onClose={() => setEditingClass(null)}
      />

      <DeleteSectionDialog
        open={deletingClass !== null}
        section={deletingClass}
        onDeleted={async () => {
          setDeletingClass(null);
          await loadClasses();
        }}
        onClose={() => setDeletingClass(null)}
      />
    </div>
  );
}
