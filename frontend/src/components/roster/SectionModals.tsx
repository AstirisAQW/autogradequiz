"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { FormField, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import {
  deleteSection,
  saveSection,
  saveStudent,
  type SectionWithCount,
  type Student,
} from "@/lib/workspace";

export function InlineNewSectionCard({
  onCreated,
  onCancel,
}: {
  onCreated: (sectionId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { push: pushToast } = useToast();
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await saveSection({
        name: name.trim(),
        term: term.trim(),
      });
      await onCreated(created.id);
      setName("");
      setTerm("");
      pushToast(`Created class "${created.name}".`, "success");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create class.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
        <FormField
          id="new-section-name"
          label="Class name"
          error={error}
        >
          <TextInput
            id="new-section-name"
            type="text"
            required
            placeholder="e.g. 10-Rizal"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            className="py-1.5"
          />
        </FormField>
        <FormField id="new-section-term" label="Term (optional)">
          <TextInput
            id="new-section-term"
            type="text"
            placeholder="e.g. Fall 2026"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="py-1.5"
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!name.trim() || busy}
            disabledReason={
              !name.trim() ? "Class name is required" : undefined
            }
          >
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function EditSectionDialog({
  open,
  section,
  onSaved,
  onClose,
}: {
  open: boolean;
  section: SectionWithCount | null;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const { push: pushToast } = useToast();
  const [name, setName] = useState(section?.name ?? "");
  const [term, setTerm] = useState(section?.term ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!section || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveSection({
        id: section.id,
        name: name.trim(),
        term: term.trim(),
      });
      await onSaved();
      onClose();
      pushToast("Class updated.", "success");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update class.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Edit class"
      busy={busy}
      hideFooter
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormField
          id="edit-section-name"
          label="Class name"
          error={error}
        >
          <TextInput
            id="edit-section-name"
            type="text"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
          />
        </FormField>
        <FormField id="edit-section-term" label="Term (optional)">
          <TextInput
            id="edit-section-term"
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!name.trim() || busy}
            disabledReason={!name.trim() ? "Class name is required" : undefined}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteSectionDialog({
  open,
  section,
  onDeleted,
  onClose,
}: {
  open: boolean;
  section: SectionWithCount | null;
  onDeleted: () => Promise<void>;
  onClose: () => void;
}) {
  const { push: pushToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (!section || busy) return;
    setBusy(true);
    try {
      const deletedName = section.name;
      await deleteSection(section.id);
      onClose();
      await onDeleted();
      pushToast(`Deleted class "${deletedName}".`, "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not delete class.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={`Delete class "${section?.name ?? "class"}"?`}
      description={`This removes the class "${section?.name ?? ""}"${section?.term ? ` (${section.term})` : ""}. ${section?.studentCount ?? 0} enrolled student${section?.studentCount === 1 ? "" : "s"} will be unassigned from this class (student records are kept), and any quizzes or batches linked to this class will have their class link cleared.`}
      confirmLabel="Delete class"
      confirmVariant="danger"
      busy={busy}
      onConfirm={() => void handleConfirm()}
      onClose={onClose}
    />
  );
}

export function AddStudentPickerDialog({
  open,
  section,
  students,
  onUpdated,
  onCreateNewInSection,
  onClose,
}: {
  open: boolean;
  section: SectionWithCount | null;
  students: Student[];
  onUpdated: () => Promise<void>;
  onCreateNewInSection: () => void;
  onClose: () => void;
}) {
  const { push: pushToast } = useToast();
  const [query, setQuery] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  const available = useMemo(() => {
    if (!section) return [];
    const q = query.trim().toLowerCase();
    return students
      .filter((stu) => !stu.sectionIds.includes(section.id))
      .filter((stu) => {
        if (!q) return true;
        return (
          stu.firstName.toLowerCase().includes(q) ||
          stu.lastName.toLowerCase().includes(q) ||
          stu.studentCode.toLowerCase().includes(q) ||
          stu.externalRef.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [students, section, query]);

  async function handleAdd(student: Student) {
    if (!section || addingId !== null) return;
    setAddingId(student.id);
    try {
      const nextIds = Array.from(new Set([...student.sectionIds, section.id]));
      await saveStudent({
        id: student.id,
        studentCode: student.studentCode,
        firstName: student.firstName,
        lastName: student.lastName,
        externalRef: student.externalRef,
        sectionIds: nextIds,
      });
      await onUpdated();
      pushToast(
        `Added ${student.firstName} ${student.lastName} to ${section.name}.`,
        "success",
      );
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not add student.",
        "error",
      );
    } finally {
      setAddingId(null);
    }
  }

  return (
    <Dialog
      open={open}
      title={`Add student to ${section?.name ?? "class"}`}
      cancelLabel="Done"
      onClose={onClose}
    >
      <div className="space-y-3">
        <TextInput
          type="search"
          aria-label="Search students to add"
          placeholder="Search by name, ID, or external ref..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="max-h-64 divide-y divide-[var(--border-hairline)] overflow-y-auto rounded-[8px] border border-[var(--border-hairline)]">
          {available.length === 0 ? (
            <div className="space-y-2 px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">
              <p>No matching students available to add.</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={onCreateNewInSection}
              >
                Create new student in {section?.name ?? "class"}
              </Button>
            </div>
          ) : (
            available.map((stu) => (
              <div
                key={stu.id}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-[var(--text-primary)]">
                    {stu.lastName}, {stu.firstName}
                  </p>
                  <p className="font-mono text-[12px] text-[var(--text-muted)]">
                    {stu.studentCode}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={addingId === stu.id}
                  onClick={() => void handleAdd(stu)}
                >
                  {addingId === stu.id ? "Adding…" : "Add"}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
