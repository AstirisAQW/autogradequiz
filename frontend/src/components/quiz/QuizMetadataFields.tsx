"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { TagInput } from "@/components/ui/TagInput";
import type { SectionWithCount } from "@/lib/workspace";

export interface QuizMetadataFieldsProps {
  idPrefix: string;
  name: string;
  onChangeName: (v: string) => void;
  date: string;
  onChangeDate: (v: string) => void;
  folder: string;
  onChangeFolder: (v: string) => void;
  availableFolders: string[];
  classes: SectionWithCount[];
  selectedClassIds: string[];
  onChangeClassIds: (next: string[]) => void;
  tags: string[];
  onChangeTags: (next: string[]) => void;
  tagSuggestions?: string[];
  extraTopContent?: React.ReactNode;
}

export function QuizMetadataFields({
  idPrefix,
  name,
  onChangeName,
  date,
  onChangeDate,
  folder,
  onChangeFolder,
  availableFolders,
  classes,
  selectedClassIds,
  onChangeClassIds,
  tags,
  onChangeTags,
  tagSuggestions = [],
  extraTopContent,
}: QuizMetadataFieldsProps) {
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderDraft, setNewFolderDraft] = useState("");

  const folderOptions = Array.from(
    new Set(["Main Folder", ...availableFolders, ...(folder ? [folder] : [])]),
  ).sort((a, b) =>
    a === "Main Folder" ? -1 : b === "Main Folder" ? 1 : a.localeCompare(b),
  );

  function toggleClass(classId: string) {
    if (selectedClassIds.includes(classId)) {
      onChangeClassIds(selectedClassIds.filter((id) => id !== classId));
    } else {
      onChangeClassIds([...selectedClassIds, classId]);
    }
  }

  return (
    <div className="space-y-4">
      <FormField id={`${idPrefix}-name`} label="Quiz name">
        <TextInput
          id={`${idPrefix}-name`}
          type="text"
          required
          placeholder="e.g. Unit 3 Biology Quiz"
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
        />
      </FormField>

      {extraTopContent}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`${idPrefix}-date`} label="Date">
          <TextInput
            id={`${idPrefix}-date`}
            type="date"
            value={date}
            onChange={(e) => onChangeDate(e.target.value)}
          />
        </FormField>

        <FormField
          id={`${idPrefix}-folder`}
          label="Folder"
          labelAction={
            <button
              type="button"
              onClick={() => {
                setAddingFolder((v) => !v);
                setNewFolderDraft("");
              }}
              className="text-[11px] font-medium text-[var(--brand-text)] hover:underline"
            >
              {addingFolder ? "Choose existing" : "+ New folder"}
            </button>
          }
        >
          {addingFolder ? (
            <div className="flex items-center gap-1.5">
              <TextInput
                id={`${idPrefix}-folder`}
                type="text"
                inputSize="sm"
                placeholder="e.g. Quarter 2"
                value={newFolderDraft}
                onChange={(e) => {
                  setNewFolderDraft(e.target.value);
                  onChangeFolder(e.target.value.trim() || "Main Folder");
                }}
              />
              {newFolderDraft.trim() && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onChangeFolder(newFolderDraft.trim());
                    setAddingFolder(false);
                  }}
                >
                  Use
                </Button>
              )}
            </div>
          ) : (
            <SelectInput
              id={`${idPrefix}-folder`}
              value={folder || "Main Folder"}
              onChange={(e) => onChangeFolder(e.target.value)}
            >
              {folderOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
      </div>

      <div>
        <span className="block text-[12px] font-medium text-[var(--text-secondary)]">
          Classes ({selectedClassIds.length})
        </span>
        {classes.length === 0 ? (
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            No classes yet — create them on the Classes page anytime.
          </p>
        ) : (
          <div className="mt-1.5 max-h-32 space-y-1.5 overflow-y-auto rounded-[8px] border border-[var(--border-hairline)] p-2.5">
            {classes.map((cls) => (
              <label
                key={cls.id}
                className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--text-primary)]"
              >
                <input
                  type="checkbox"
                  checked={selectedClassIds.includes(cls.id)}
                  onChange={() => toggleClass(cls.id)}
                  className="h-4 w-4 accent-[var(--brand)]"
                />
                <span>{cls.name}</span>
                {cls.term && (
                  <span className="text-[11px] text-[var(--text-muted)]">
                    ({cls.term})
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      <FormField id={`${idPrefix}-tags`} label={`Tags (${tags.length})`}>
        <TagInput
          id={`${idPrefix}-tags`}
          tags={tags}
          onChange={onChangeTags}
          suggestions={tagSuggestions}
          placeholder="Add quiz tag (e.g. Midterm, Bio)"
        />
      </FormField>
    </div>
  );
}
