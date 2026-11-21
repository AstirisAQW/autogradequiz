"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import {
  submitReview,
  type KeyVersionId,
  type Paper,
  type ReviewQueueItem,
  type Student,
} from "@/lib/workspace";

interface ReviewIdentityBarProps {
  scan: ReviewQueueItem;
  students: Student[];
  onUpdated: (updated: Paper) => void;
}

export function ReviewIdentityBar({
  scan,
  students,
  onUpdated,
}: ReviewIdentityBarProps) {
  const { push: pushToast } = useToast();
  const [selectedStudentId, setSelectedStudentId] = useState(
    scan.studentId ?? "",
  );
  const [studentIdText, setStudentIdText] = useState(scan.studentIdText ?? "");
  const [nameText, setNameText] = useState(scan.nameText ?? "");
  const [dateText, setDateText] = useState(scan.dateText ?? "");
  const [sectionText, setSectionText] = useState(scan.sectionText ?? "");
  const [keyVersion, setKeyVersion] = useState<KeyVersionId>(
    scan.keyVersion ?? "A",
  );
  const [savingIdentity, setSavingIdentity] = useState(false);

  const availableKeyVersions = scan.availableKeyVersions ?? ["A"];
  const hasMultipleKeys = availableKeyVersions.length > 1;
  const currentKeyVersion: KeyVersionId = scan.keyVersion ?? "A";
  const currentStudentIdStr = scan.studentId ?? "";
  const currentStudentIdText = scan.studentIdText ?? "";
  const anyIdentityTextChanged =
    nameText !== scan.nameText ||
    dateText !== scan.dateText ||
    sectionText !== scan.sectionText ||
    studentIdText !== currentStudentIdText ||
    selectedStudentId !== currentStudentIdStr;
  const keyVersionChanged =
    hasMultipleKeys &&
    (keyVersion !== currentKeyVersion || Boolean(scan.keyVersionFlagged));
  const identityChanged = anyIdentityTextChanged || keyVersionChanged;

  async function handleSaveIdentity(event: React.FormEvent) {
    event.preventDefault();
    if (!identityChanged || savingIdentity) return;

    setSavingIdentity(true);
    try {
      const updated = await submitReview(scan.id, {
        ...(keyVersionChanged ? { keyVersion } : {}),
        ...(anyIdentityTextChanged
          ? {
              identity: {
                nameText: nameText !== scan.nameText ? nameText : undefined,
                dateText: dateText !== scan.dateText ? dateText : undefined,
                sectionText:
                  sectionText !== scan.sectionText ? sectionText : undefined,
                studentIdText:
                  studentIdText !== currentStudentIdText
                    ? studentIdText
                    : undefined,
                studentId:
                  selectedStudentId !== currentStudentIdStr
                    ? selectedStudentId || null
                    : undefined,
              },
            }
          : {}),
      });
      onUpdated(updated);
      setNameText(updated.nameText);
      setDateText(updated.dateText);
      setSectionText(updated.sectionText);
      setStudentIdText(updated.studentIdText ?? "");
      setSelectedStudentId(updated.studentId ?? "");
      setKeyVersion(updated.keyVersion ?? "A");
      pushToast(
        keyVersionChanged ? "Identity and key version saved." : "Identity saved.",
        "success",
      );
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not save identity.",
        "error",
      );
    } finally {
      setSavingIdentity(false);
    }
  }

  async function handleUnlinkStudent() {
    if (!currentStudentIdStr || savingIdentity) return;
    const scanId = scan.id;
    const previousStudentId = currentStudentIdStr;
    setSavingIdentity(true);
    try {
      const updated = await submitReview(scanId, {
        identity: { studentId: null },
      });
      onUpdated(updated);
      setSelectedStudentId("");
      pushToast("Student unlinked.", "info", {
        actionLabel: "Undo",
        onAction: async () => {
          try {
            const relinked = await submitReview(scanId, {
              identity: { studentId: previousStudentId },
            });
            onUpdated(relinked);
            pushToast("Restored student link.", "success");
          } catch (err) {
            pushToast(
              err instanceof Error
                ? err.message
                : "Could not restore student link.",
              "error",
            );
          }
        },
      });
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not unlink student.",
        "error",
      );
    } finally {
      setSavingIdentity(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSaveIdentity(e)}
      className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)]/40 px-6 py-3"
    >
      <div
        className={`grid items-end gap-3 sm:grid-cols-2 ${
          hasMultipleKeys
            ? "lg:grid-cols-[1.15fr_0.85fr_1.05fr_0.75fr_0.75fr_0.6fr_auto]"
            : "lg:grid-cols-[1.2fr_0.9fr_1.1fr_0.75fr_0.75fr_auto]"
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
                className="text-[11px] font-medium text-[var(--brand-text)] hover:underline"
              >
                Add students →
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
                if (!nameText) {
                  setNameText(`${stu.lastName}, ${stu.firstName}`);
                }
                if (!studentIdText) {
                  setStudentIdText(stu.studentCode);
                }
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
            className="font-mono"
          />
        </FormField>

        <FormField id="review-name" label="Name" size="sm">
          <TextInput
            id="review-name"
            type="text"
            inputSize="sm"
            placeholder="e.g. Dela Cruz, Juan"
            value={nameText}
            onChange={(e) => setNameText(e.target.value)}
          />
        </FormField>

        <FormField id="review-section" label="Class" size="sm">
          <TextInput
            id="review-section"
            type="text"
            inputSize="sm"
            placeholder="e.g. 10-Rizal"
            value={sectionText}
            onChange={(e) => setSectionText(e.target.value)}
          />
        </FormField>

        <FormField id="review-date" label="Date" size="sm">
          <TextInput
            id="review-date"
            type="text"
            inputSize="sm"
            placeholder="2026-11-18"
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
              scan.keyVersionFlagged ? (
                <span className="text-[10px] font-medium text-[var(--warning-text)]">
                  Unclear
                </span>
              ) : undefined
            }
          >
            <SelectInput
              id="review-key-version"
              selectSize="sm"
              value={keyVersion}
              onChange={(e) => setKeyVersion(e.target.value as KeyVersionId)}
            >
              {availableKeyVersions.map((ver) => (
                <option key={ver} value={ver}>
                  {ver}
                </option>
              ))}
            </SelectInput>
          </FormField>
        )}

        <div className="flex items-center gap-1.5">
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={!identityChanged || savingIdentity}
            disabledReason={
              !identityChanged ? "No identity changes to save" : undefined
            }
          >
            {savingIdentity ? "Saving…" : "Save identity"}
          </Button>
          {currentStudentIdStr && (
            <Button
              variant="ghost"
              size="sm"
              disabled={savingIdentity}
              onClick={() => void handleUnlinkStudent()}
              className="text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
            >
              Unlink
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
