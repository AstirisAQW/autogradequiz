"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { FormField, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/lib/api";
import {
  saveStudent,
  type ClassWithCount,
  type Student,
} from "@/lib/workspace";

export interface StudentFormDrawerProps {
  open: boolean;
  student: Student | null;
  classes: ClassWithCount[];
  defaultClassId: string;
  suggestedStudentCode?: string;
  onSaved: () => Promise<void>;
  onClose: () => void;
}

function validateStudentCode(raw: string): string | null {
  const val = raw.trim();
  if (!val) return "Student ID is required";
  const alnumCount = val.replace(/[^a-zA-Z0-9]/g, "").length;
  if (alnumCount < 2 || val.length > 32) {
    return "Include at least 2 letters or numbers (up to 32 characters)";
  }
  return null;
}

export function StudentFormDrawer({
  open,
  student,
  classes,
  defaultClassId,
  suggestedStudentCode = "",
  onSaved,
  onClose,
}: StudentFormDrawerProps) {
  const { push: pushToast } = useToast();
  const [studentCode, setStudentCode] = useState(
    student?.studentCode ?? suggestedStudentCode,
  );
  const [codeTouched, setCodeTouched] = useState(false);

  const [firstName, setFirstName] = useState(student?.firstName ?? "");
  const [firstTouched, setFirstTouched] = useState(false);

  const [lastName, setLastName] = useState(student?.lastName ?? "");
  const [lastTouched, setLastTouched] = useState(false);

  const [externalRef, setExternalRef] = useState(student?.externalRef ?? "");
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>(() =>
    student ? student.classIds : defaultClassId ? [defaultClassId] : [],
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const codeClientErr = validateStudentCode(studentCode);
  const firstClientErr = !firstName.trim() ? "First name is required" : null;
  const lastClientErr = !lastName.trim() ? "Last name is required" : null;

  const visibleCodeErr =
    serverError ?? (codeTouched ? codeClientErr : null);
  const visibleFirstErr = firstTouched ? firstClientErr : null;
  const visibleLastErr = lastTouched ? lastClientErr : null;

  const firstError = firstClientErr ?? lastClientErr ?? codeClientErr;

  function toggleClass(classId: string) {
    setSelectedClassIds((prev) =>
      prev.includes(classId)
        ? prev.filter((id) => id !== classId)
        : [...prev, classId],
    );
  }

  async function handleSaveStudent(e: React.FormEvent) {
    e.preventDefault();
    setFirstTouched(true);
    setLastTouched(true);
    setCodeTouched(true);
    if (firstError || saving) return;

    setSaving(true);
    setServerError(null);
    try {
      const saved = await saveStudent({
        id: student?.id,
        studentCode: studentCode.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        externalRef: externalRef.trim(),
        classIds: selectedClassIds,
      });
      await onSaved();
      pushToast(
        student
          ? `Saved ${saved.firstName} ${saved.lastName}.`
          : `Added ${saved.firstName} ${saved.lastName}.`,
        "success",
      );
      onClose();
    } catch (err) {
      setServerError(getErrorMessage(err, "Could not save student."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      title={student ? "Edit student" : "New student"}
      subtitle="Student ID links uploaded scans automatically."
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(e) => void handleSaveStudent(e)}
        className="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="drawer-first-name"
            label="First name"
            error={visibleFirstErr}
          >
            <TextInput
              id="drawer-first-name"
              type="text"
              aria-required="true"
              hasError={Boolean(visibleFirstErr)}
              placeholder="e.g. Juan"
              value={firstName}
              onBlur={() => setFirstTouched(true)}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </FormField>

          <FormField
            id="drawer-last-name"
            label="Last name"
            error={visibleLastErr}
          >
            <TextInput
              id="drawer-last-name"
              type="text"
              aria-required="true"
              hasError={Boolean(visibleLastErr)}
              placeholder="e.g. Dela Cruz"
              value={lastName}
              onBlur={() => setLastTouched(true)}
              onChange={(e) => setLastName(e.target.value)}
            />
          </FormField>
        </div>

        <FormField
          id="drawer-student-code"
          label="Student ID"
          error={visibleCodeErr}
        >
          <TextInput
            id="drawer-student-code"
            type="text"
            aria-required="true"
            hasError={Boolean(visibleCodeErr)}
            placeholder="e.g. 0123456789"
            value={studentCode}
            onBlur={() => setCodeTouched(true)}
            onChange={(e) => {
              setStudentCode(e.target.value);
              if (serverError) setServerError(null);
            }}
            className="font-mono tabular-nums"
          />
        </FormField>

        <FormField id="drawer-external-ref" label="LRN (optional)">
          <TextInput
            id="drawer-external-ref"
            type="text"
            placeholder="e.g. LRN-4821"
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
          />
        </FormField>

        <div>
          <span className="block text-xs font-medium text-[var(--text-secondary)]">
            Classes
          </span>
          {classes.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              No classes in this folder yet.
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {classes.map((cls) => {
                const checked = selectedClassIds.includes(cls.id);
                return (
                  <label
                    key={cls.id}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[0.8125rem] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleClass(cls.id)}
                      className="h-4 w-4 accent-[var(--brand)]"
                    />
                    <span>{cls.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-hairline)] pt-4">
          <Button
            variant="secondary"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving
              ? "Saving..."
              : student
                ? "Save student"
                : "Create student"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
