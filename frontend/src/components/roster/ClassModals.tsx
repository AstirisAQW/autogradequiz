"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { FormField, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/lib/api";
import {
  deleteClass,
  saveClass,
  saveStudent,
  type ClassWithCount,
  type Student,
} from "@/lib/workspace";

export function InlineNewClassCard({
  onCreated,
  onCancel,
}: {
  onCreated: (classId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { push: pushToast } = useToast();
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [term, setTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clientErr = !name.trim() ? "Enter a class name" : null;
  const visibleError = error ?? (touched ? clientErr : null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (clientErr || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await saveClass({
        name: name.trim(),
        term: term.trim(),
      });
      await onCreated(created.id);
      setName("");
      setTerm("");
      setTouched(false);
      pushToast(`Created class "${created.name}".`, "success");
    } catch (err) {
      setError(getErrorMessage(err, "Could not create class."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form
        noValidate
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-3"
      >
        <FormField
          id="new-class-name"
          label="Class name"
          error={visibleError}
        >
          <TextInput
            id="new-class-name"
            type="text"
            aria-required="true"
            hasError={Boolean(visibleError)}
            placeholder="e.g. 10-Rizal"
            value={name}
            onBlur={() => setTouched(true)}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
          />
        </FormField>
        <FormField id="new-class-term" label="Term (optional)">
          <TextInput
            id="new-class-term"
            type="text"
            placeholder="e.g. Midterm"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </FormField>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? "Creating..." : "Create class"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function EditClassDialog({
  open,
  classItem,
  onSaved,
  onClose,
}: {
  open: boolean;
  classItem: ClassWithCount | null;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const { push: pushToast } = useToast();
  const [name, setName] = useState(classItem?.name ?? "");
  const [touched, setTouched] = useState(false);
  const [term, setTerm] = useState(classItem?.term ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clientErr = !name.trim() ? "Enter a class name" : null;
  const visibleError = error ?? (touched ? clientErr : null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!classItem || clientErr || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveClass({
        id: classItem.id,
        name: name.trim(),
        term: term.trim(),
      });
      await onSaved();
      onClose();
      pushToast(`Updated class "${name.trim()}".`, "success");
    } catch (err) {
      setError(getErrorMessage(err, "Could not update class."));
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
      <form
        noValidate
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-4"
      >
        <FormField
          id="edit-class-name"
          label="Class name"
          error={visibleError}
        >
          <TextInput
            id="edit-class-name"
            type="text"
            aria-required="true"
            hasError={Boolean(visibleError)}
            value={name}
            onBlur={() => setTouched(true)}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
          />
        </FormField>
        <FormField id="edit-class-term" label="Term (optional)">
          <TextInput
            id="edit-class-term"
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </FormField>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving..." : "Save class"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteClassDialog({
  open,
  classItem,
  onDeleted,
  onClose,
}: {
  open: boolean;
  classItem: ClassWithCount | null;
  onDeleted: () => Promise<void>;
  onClose: () => void;
}) {
  const { push: pushToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (!classItem || busy) return;
    setBusy(true);
    try {
      const deletedName = classItem.name;
      await deleteClass(classItem.id);
      onClose();
      await onDeleted();
      pushToast(`Deleted class "${deletedName}".`, "success");
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not delete class."), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={`Delete class "${classItem?.name ?? "class"}"?`}
      description="Students stay in the directory, and any quizzes linked to this class remain available."
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
  classItem,
  students,
  onUpdated,
  onCreateNewInClass,
  onClose,
}: {
  open: boolean;
  classItem: ClassWithCount | null;
  students: Student[];
  onUpdated: () => Promise<void>;
  onCreateNewInClass: () => void;
  onClose: () => void;
}) {
  const { push: pushToast } = useToast();
  const [query, setQuery] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  const available = useMemo(() => {
    if (!classItem) return [];
    const q = query.trim().toLowerCase();
    return students
      .filter((stu) => !stu.classIds.includes(classItem.id))
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
  }, [students, classItem, query]);

  async function handleAdd(student: Student) {
    if (!classItem || addingId !== null) return;
    setAddingId(student.id);
    try {
      const nextIds = Array.from(new Set([...student.classIds, classItem.id]));
      await saveStudent({
        id: student.id,
        studentCode: student.studentCode,
        firstName: student.firstName,
        lastName: student.lastName,
        externalRef: student.externalRef,
        classIds: nextIds,
      });
      await onUpdated();
      pushToast(
        `Added ${student.firstName} ${student.lastName} to ${classItem.name}.`,
        "success",
      );
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not add student."), "error");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <Dialog
      open={open}
      title={`Add student to ${classItem?.name ?? "class"}`}
      cancelLabel="Done"
      onClose={onClose}
    >
      <div className="space-y-3">
        <TextInput
          type="search"
          aria-label="Search students to add"
          placeholder="Search by name, Student ID, or LRN"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="max-h-64 divide-y divide-[var(--border-hairline)] overflow-y-auto rounded-lg border border-[var(--border-hairline)]">
          {available.length === 0 ? (
            <div className="space-y-2 px-4 py-6 text-center text-xs text-[var(--text-muted)]">
              <p>No matching students available to add.</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={onCreateNewInClass}
              >
                Create new student in {classItem?.name ?? "class"}
              </Button>
            </div>
          ) : (
            available.map((stu) => (
              <div
                key={stu.id}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {stu.lastName}, {stu.firstName}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] tabular-nums">
                    {stu.studentCode}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={addingId === stu.id}
                  onClick={() => void handleAdd(stu)}
                >
                  {addingId === stu.id ? "Adding..." : "Add"}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
