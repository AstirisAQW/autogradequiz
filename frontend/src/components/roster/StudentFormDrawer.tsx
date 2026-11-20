"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";
import { FormField, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import {
  deleteStudent,
  saveStudent,
  type SectionWithCount,
  type Student,
} from "@/lib/workspace";

export interface StudentFormDrawerProps {
  open: boolean;
  student: Student | null;
  sections: SectionWithCount[];
  defaultSectionId: string;
  suggestedStudentCode?: string;
  onSaved: () => Promise<void>;
  onDeleted?: () => void;
  onClose: () => void;
}

export function StudentFormDrawer({
  open,
  student,
  sections,
  defaultSectionId,
  suggestedStudentCode = "",
  onSaved,
  onDeleted,
  onClose,
}: StudentFormDrawerProps) {
  const { push: pushToast } = useToast();
  const [studentCode, setStudentCode] = useState(
    student?.studentCode ?? suggestedStudentCode,
  );
  const [firstName, setFirstName] = useState(student?.firstName ?? "");
  const [lastName, setLastName] = useState(student?.lastName ?? "");
  const [externalRef, setExternalRef] = useState(student?.externalRef ?? "");
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>(() =>
    student ? student.sectionIds : defaultSectionId ? [defaultSectionId] : [],
  );
  const [codeError, setCodeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function toggleSection(secId: string) {
    setSelectedSectionIds((prev) =>
      prev.includes(secId)
        ? prev.filter((id) => id !== secId)
        : [...prev, secId],
    );
  }

  async function handleSaveStudent(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setCodeError(null);
    try {
      const saved = await saveStudent({
        id: student?.id,
        studentCode: studentCode.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        externalRef: externalRef.trim(),
        sectionIds: selectedSectionIds,
      });
      await onSaved();
      pushToast(
        student
          ? "Student updated."
          : `Added ${saved.firstName} ${saved.lastName}.`,
        "success",
      );
      onClose();
    } catch (err) {
      setCodeError(
        err instanceof Error ? err.message : "Could not save student.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteStudent() {
    if (!student || deleting) return;
    setDeleting(true);
    try {
      const fullName = `${student.firstName} ${student.lastName}`;
      await deleteStudent(student.id);
      setDeleteOpen(false);
      onClose();
      await onSaved();
      onDeleted?.();
      pushToast(`Deleted ${fullName}.`, "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not delete student.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  const formInvalid =
    !studentCode.trim() || !firstName.trim() || !lastName.trim();

  return (
    <>
      <Drawer
        open={open}
        title={student ? "Edit student" : "New student"}
        subtitle={
          student
            ? `Student ID: ${student.studentCode}`
            : "Add a student to your directory"
        }
        onClose={onClose}
      >
        <form
          onSubmit={(e) => void handleSaveStudent(e)}
          className="space-y-4"
        >
          <FormField
            id="drawer-student-code"
            label="Student ID"
            error={codeError}
          >
            <TextInput
              id="drawer-student-code"
              type="text"
              required
              placeholder="e.g. 0123456789"
              value={studentCode}
              onChange={(e) => {
                setStudentCode(e.target.value);
                if (codeError) setCodeError(null);
              }}
              className="font-mono"
            />
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="drawer-first-name" label="First name">
              <TextInput
                id="drawer-first-name"
                type="text"
                required
                placeholder="e.g. Juan"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </FormField>

            <FormField id="drawer-last-name" label="Last name">
              <TextInput
                id="drawer-last-name"
                type="text"
                required
                placeholder="e.g. Dela Cruz"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </FormField>
          </div>

          <FormField
            id="drawer-external-ref"
            label="External ref (optional)"
          >
            <TextInput
              id="drawer-external-ref"
              type="text"
              placeholder="e.g. LMS or SIS ID"
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
            />
          </FormField>

          <div>
            <span className="block text-[12px] font-medium text-[var(--text-secondary)]">
              Classes
            </span>
            {sections.length === 0 ? (
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                No classes created yet.
              </p>
            ) : (
              <div className="mt-1.5 max-h-48 space-y-1.5 overflow-y-auto rounded-[8px] border border-[var(--border-hairline)] p-3">
                {sections.map((sec) => {
                  const checked = selectedSectionIds.includes(sec.id);
                  return (
                    <label
                      key={sec.id}
                      className="flex cursor-pointer items-center gap-2.5 text-[14px] text-[var(--text-primary)]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSection(sec.id)}
                        className="h-4 w-4 accent-[var(--brand)]"
                      />
                      <span>{sec.name}</span>
                      {sec.term && (
                        <span className="text-[12px] text-[var(--text-muted)]">
                          ({sec.term})
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-hairline)] pt-4">
            {student ? (
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => setDeleteOpen(true)}
                className="text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
              >
                Delete student
              </Button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={formInvalid || saving}
                disabledReason={
                  formInvalid
                    ? "Student ID, first name, and last name are required"
                    : undefined
                }
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </Drawer>

      <Dialog
        open={deleteOpen}
        title={`Delete student "${student?.lastName ?? ""}, ${student?.firstName ?? ""}"?`}
        description={`This permanently removes student "${student?.lastName ?? ""}, ${student?.firstName ?? ""}" (Student ID: ${student?.studentCode ?? ""}) and unenrolls them from ${student?.sectionIds.length ?? 0} class${student?.sectionIds.length === 1 ? "" : "es"}. Any graded papers linked to this student will keep their score and written name but be unlinked from the directory.`}
        confirmLabel="Delete student"
        confirmVariant="danger"
        busy={deleting}
        onConfirm={() => void handleDeleteStudent()}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  );
}
