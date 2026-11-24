import type { ReactNode, Ref } from "react";
import { FormField, TextInput } from "@/components/ui/Field";
import { TagInput } from "@/components/ui/TagInput";
import type { ClassWithCount } from "@/lib/workspace";

export interface QuizMetadataFieldsProps {
  idPrefix: string;
  name: string;
  nameError?: string | null;
  nameInputRef?: Ref<HTMLInputElement>;
  onBlurName?: () => void;
  onChangeName: (v: string) => void;
  date: string;
  onChangeDate: (v: string) => void;
  classes: ClassWithCount[];
  selectedClassIds: string[];
  onChangeClassIds: (next: string[]) => void;
  tags: string[];
  onChangeTags: (next: string[]) => void;
  tagSuggestions?: string[];
  extraTopContent?: ReactNode;
}

export function QuizMetadataFields({
  idPrefix,
  name,
  nameError,
  nameInputRef,
  onBlurName,
  onChangeName,
  date,
  onChangeDate,
  classes,
  selectedClassIds,
  onChangeClassIds,
  tags,
  onChangeTags,
  tagSuggestions = [],
  extraTopContent,
}: QuizMetadataFieldsProps) {
  function toggleClass(classId: string) {
    if (selectedClassIds.includes(classId)) {
      onChangeClassIds(selectedClassIds.filter((id) => id !== classId));
    } else {
      onChangeClassIds([...selectedClassIds, classId]);
    }
  }

  return (
    <div className="space-y-4">
      <FormField id={`${idPrefix}-name`} label="Quiz name" error={nameError}>
        <TextInput
          ref={nameInputRef}
          id={`${idPrefix}-name`}
          type="text"
          aria-required="true"
          hasError={Boolean(nameError)}
          placeholder="e.g. Unit 3 Biology Quiz"
          value={name}
          onBlur={onBlurName}
          onChange={(e) => onChangeName(e.target.value)}
        />
      </FormField>

      {extraTopContent}

      <FormField id={`${idPrefix}-date`} label="Date">
        <TextInput
          id={`${idPrefix}-date`}
          type="date"
          value={date}
          onChange={(e) => onChangeDate(e.target.value)}
        />
      </FormField>

      <div>
        <span className="block text-xs font-medium text-[var(--text-secondary)]">
          Classes ({selectedClassIds.length})
        </span>
        {classes.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            No classes in this folder yet. Create them on the Classes page.
          </p>
        ) : (
          <div className="mt-1.5 max-h-32 space-y-1.5 overflow-y-auto rounded-lg border border-[var(--border-hairline)] p-2.5">
            {classes.map((cls) => (
              <label
                key={cls.id}
                className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-[var(--text-primary)]"
              >
                <input
                  type="checkbox"
                  checked={selectedClassIds.includes(cls.id)}
                  onChange={() => toggleClass(cls.id)}
                  className="h-4 w-4 accent-[var(--brand)]"
                />
                <span>{cls.name}</span>
                {cls.term && (
                  <span className="text-[0.6875rem] text-[var(--text-muted)]">
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
