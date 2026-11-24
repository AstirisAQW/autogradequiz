"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/lib/api";
import { formatHumanDate } from "@/lib/format";
import {
  submitReview,
  type KeyVersionId,
  type Paper,
  type ReviewQueueItem,
  type Student,
} from "@/lib/workspace";

interface ReviewIdentityBarProps {
  paper: ReviewQueueItem;
  students: Student[];
  onUpdated: (updated: Paper) => void;
}

export function ReviewIdentityBar({
  paper,
  students,
  onUpdated,
}: ReviewIdentityBarProps) {
  const { push: pushToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState(
    paper.studentId ?? "",
  );
  const [studentIdText, setStudentIdText] = useState(paper.studentIdText ?? "");
  const [nameText, setNameText] = useState(paper.nameText ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  const [dateText, setDateText] = useState(paper.dateText ?? "");
  const [classText, setClassText] = useState(paper.classText ?? "");
  const [keyVersion, setKeyVersion] = useState<KeyVersionId>(
    paper.keyVersion ?? "A",
  );
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);

  const availableKeyVersions = paper.availableKeyVersions ?? ["A"];
  const hasMultipleKeys = availableKeyVersions.length > 1;
  const currentKeyVersion: KeyVersionId = paper.keyVersion ?? "A";
  const currentStudentIdStr = paper.studentId ?? "";
  const currentStudentIdText = paper.studentIdText ?? "";
  const newlyLinkedStudent =
    selectedStudentId && selectedStudentId !== currentStudentIdStr
      ? students.find((s) => s.id === selectedStudentId)
      : undefined;
  const presetLinkedName = newlyLinkedStudent
    ? `${newlyLinkedStudent.lastName}, ${newlyLinkedStudent.firstName}`
    : null;
  const presetLinkedCode = newlyLinkedStudent
    ? newlyLinkedStudent.studentCode
    : null;
  const nameEdited =
    nameText !== paper.nameText &&
    (presetLinkedName === null || nameText.trim() !== presetLinkedName);
  const studentIdTextEdited =
    studentIdText !== currentStudentIdText &&
    (presetLinkedCode === null || studentIdText.trim() !== presetLinkedCode);
  const anyIdentityTextChanged =
    nameEdited ||
    dateText !== paper.dateText ||
    classText !== paper.classText ||
    studentIdTextEdited ||
    selectedStudentId !== currentStudentIdStr;
  const keyVersionChanged =
    hasMultipleKeys &&
    (keyVersion !== currentKeyVersion || Boolean(paper.keyVersionFlagged));
  const identityChanged = anyIdentityTextChanged || keyVersionChanged;

  const nameError = !nameText.trim() ? "Student name cannot be empty" : null;

  function syncFormFromPaper() {
    setSelectedStudentId(paper.studentId ?? "");
    setStudentIdText(paper.studentIdText ?? "");
    setNameText(paper.nameText ?? "");
    setDateText(paper.dateText ?? "");
    setClassText(paper.classText ?? "");
    setKeyVersion(paper.keyVersion ?? "A");
    setNameTouched(false);
  }

  async function handleSaveIdentity(event: React.FormEvent) {
    event.preventDefault();
    setNameTouched(true);
    if (!identityChanged || savingIdentity) return;
    if (nameEdited && nameError) return;

    setSavingIdentity(true);
    try {
      const updated = await submitReview(paper.quizId, paper.id, {
        ...(keyVersionChanged ? { keyVersion } : {}),
        ...(anyIdentityTextChanged
          ? {
              identity: {
                nameText: nameEdited ? nameText.trim() : undefined,
                dateText: dateText !== paper.dateText ? dateText : undefined,
                classText:
                  classText !== paper.classText ? classText : undefined,
                studentIdText: studentIdTextEdited ? studentIdText : undefined,
                studentId:
                  selectedStudentId !== currentStudentIdStr
                    ? selectedStudentId || null
                    : undefined,
              },
            }
          : {}),
      });
      onUpdated(updated);
      setEditing(false);
      setNameTouched(false);
      pushToast(
        keyVersionChanged
          ? "Identity and key version saved."
          : "Identity saved.",
        "success",
      );
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not save identity."), "error");
    } finally {
      setSavingIdentity(false);
    }
  }

  async function handleUnlinkStudent() {
    if (!currentStudentIdStr || savingIdentity) return;
    const paperId = paper.id;
    const previousStudentId = currentStudentIdStr;
    setSavingIdentity(true);
    try {
      const updated = await submitReview(paper.quizId, paperId, {
        identity: { studentId: null },
      });
      setUnlinkConfirmOpen(false);
      syncFormFromPaper();
      setSelectedStudentId("");
      setEditing(true);
      onUpdated(updated);
      pushToast("Unlinked student from paper.", "info", {
        actionLabel: "Undo",
        onAction: async () => {
          try {
            const relinked = await submitReview(paper.quizId, paperId, {
              identity: { studentId: previousStudentId },
            });
            onUpdated(relinked);
            pushToast("Restored student link.", "success");
          } catch (err) {
            pushToast(
              getErrorMessage(err, "Could not restore student link."),
              "error",
            );
          }
        },
      });
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not unlink student."), "error");
    } finally {
      setSavingIdentity(false);
    }
  }

  const identityMenuItems = currentStudentIdStr
    ? [
        {
          id: "unlink",
          label: "Unlink student",
          variant: "danger" as const,
          onClick: () => setUnlinkConfirmOpen(true),
        },
      ]
    : [
        {
          id: "students",
          label: "Open students directory",
          href: "/students",
        },
      ];

  return (
    <>
      {!editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)]/40 px-6 py-2.5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.8125rem]">
            {!currentStudentIdStr && (
              <span className="font-medium text-[var(--warning-text)]">
                Unlinked student
              </span>
            )}
            <span className="tabular-nums">
              <span className="mr-1.5 text-[0.6875rem] font-medium text-[var(--text-muted)]">
                ID
              </span>
              {paper.studentIdText || "—"}
            </span>
            <span>
              <span className="mr-1.5 text-[0.6875rem] font-medium text-[var(--text-muted)]">
                Class
              </span>
              {paper.classText || "—"}
            </span>
            <span className="tabular-nums">
              <span className="mr-1.5 text-[0.6875rem] font-medium text-[var(--text-muted)]">
                Date
              </span>
              {formatHumanDate(paper.dateText) || "—"}
            </span>
            {hasMultipleKeys && (
              <span>
                <span className="mr-1.5 text-[0.6875rem] font-medium text-[var(--text-muted)]">
                  Key
                </span>
                {paper.keyVersion ?? "A"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                syncFormFromPaper();
                setEditing(true);
              }}
            >
              {currentStudentIdStr ? "Edit details" : "Link student"}
            </Button>
            <ActionMenu label="Identity actions" items={identityMenuItems} />
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => void handleSaveIdentity(e)}
          className="space-y-2.5 border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)]/40 px-6 py-3"
        >
          <div
            className={`grid items-start gap-3 sm:grid-cols-2 ${
              hasMultipleKeys
                ? "lg:grid-cols-[1.2fr_0.85fr_1.1fr_0.8fr_0.85fr_0.55fr]"
                : "lg:grid-cols-[1.25fr_0.9fr_1.1fr_0.8fr_0.85fr]"
            }`}
          >
            <FormField
              id="review-student"
              label="Student link"
              size="sm"
              labelAction={
                students.length === 0 ? (
                  <Link
                    href="/students"
                    className="text-[0.6875rem] font-medium text-[var(--brand-text)] underline underline-offset-2"
                  >
                    Add students
                  </Link>
                ) : undefined
              }
            >
              <SelectInput
                id="review-student"
                selectSize="sm"
                value={selectedStudentId}
                disabled={students.length === 0}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedStudentId(val);
                  const stu = students.find((s) => s.id === val);
                  if (stu) {
                    setNameText(`${stu.lastName}, ${stu.firstName}`);
                    setStudentIdText(stu.studentCode);
                  }
                }}
              >
                <option value="">
                  {students.length === 0 ? "No students yet" : "Unlinked"}
                </option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.lastName}, {s.firstName} ({s.studentCode})
                  </option>
                ))}
              </SelectInput>
            </FormField>

            <FormField id="review-student-id-text" label="Student ID" size="sm">
              <TextInput
                id="review-student-id-text"
                type="text"
                inputSize="sm"
                placeholder="e.g. 0123456789"
                value={studentIdText}
                onChange={(e) => setStudentIdText(e.target.value)}
                className="font-mono tabular-nums"
              />
            </FormField>

            <FormField
              id="review-name"
              label="Name"
              size="sm"
              error={
                nameTouched && nameText !== paper.nameText ? nameError : null
              }
            >
              <TextInput
                id="review-name"
                type="text"
                inputSize="sm"
                hasError={Boolean(
                  nameTouched && nameText !== paper.nameText && nameError,
                )}
                placeholder="e.g. Dela Cruz, Juan"
                value={nameText}
                onBlur={() => setNameTouched(true)}
                onChange={(e) => setNameText(e.target.value)}
              />
            </FormField>

            <FormField id="review-class" label="Class" size="sm">
              <TextInput
                id="review-class"
                type="text"
                inputSize="sm"
                placeholder="e.g. 10-Rizal"
                value={classText}
                onChange={(e) => setClassText(e.target.value)}
              />
            </FormField>

            <FormField id="review-date" label="Date" size="sm">
              <TextInput
                id="review-date"
                type="date"
                inputSize="sm"
                value={dateText}
                onChange={(e) => setDateText(e.target.value)}
              />
            </FormField>

            {hasMultipleKeys && (
              <FormField
                id="review-key-version"
                label="Key"
                size="sm"
                labelAction={
                  paper.keyVersionFlagged ? (
                    <span className="text-[0.625rem] font-medium text-[var(--warning-text)]">
                      Unclear
                    </span>
                  ) : undefined
                }
              >
                <SelectInput
                  id="review-key-version"
                  selectSize="sm"
                  value={keyVersion}
                  onChange={(e) =>
                    setKeyVersion(e.target.value as KeyVersionId)
                  }
                >
                  {availableKeyVersions.map((ver) => (
                    <option key={ver} value={ver}>
                      {ver}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {identityChanged && (
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={
                    savingIdentity ||
                    Boolean(nameText !== paper.nameText && nameError)
                  }
                  disabledReason={
                    nameText !== paper.nameText && nameError
                      ? nameError
                      : undefined
                  }
                >
                  {savingIdentity ? "Saving..." : "Save identity"}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  syncFormFromPaper();
                }}
              >
                Cancel
              </Button>
            </div>
            <ActionMenu label="Identity actions" items={identityMenuItems} />
          </div>
        </form>
      )}

      <Dialog
        open={unlinkConfirmOpen}
        title="Unlink student from paper?"
        description="The paper remains graded, but it will no longer appear on this student's profile."
        confirmLabel="Unlink student"
        confirmVariant="danger"
        busy={savingIdentity}
        onConfirm={() => void handleUnlinkStudent()}
        onClose={() => setUnlinkConfirmOpen(false)}
      />
    </>
  );
}
