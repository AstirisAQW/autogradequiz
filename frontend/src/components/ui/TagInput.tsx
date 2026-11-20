"use client";

import { useState } from "react";
import { Button } from "./Button";
import { TextInput } from "./Field";

export interface TagInputProps {
  id?: string;
  tags: string[];
  onChange: (nextTags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}

export function TagInput({
  id,
  tags,
  onChange,
  suggestions = [],
  placeholder = "Add a tag (e.g. Unit 3)",
}: TagInputProps) {
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const cleaned = raw.trim();
    if (!cleaned) return;
    if (!tags.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
      onChange([...tags, cleaned]);
    }
    setDraft("");
  }

  function removeTag(target: string) {
    onChange(tags.filter((t) => t !== target));
  }

  const unusedSuggestions = suggestions.filter(
    (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--text-primary)]"
            >
              <span>{tag}</span>
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => removeTag(tag)}
                className="ml-0.5 rounded-full px-1 text-[var(--text-muted)] hover:bg-black/10 hover:text-[var(--text-primary)]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <TextInput
          id={id}
          type="text"
          inputSize="sm"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag(draft);
            }
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!draft.trim()}
          onClick={() => addTag(draft)}
        >
          + Add tag
        </Button>
      </div>

      {unusedSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span>Suggestions:</span>
          {unusedSuggestions.slice(0, 8).map((sug) => (
            <button
              key={sug}
              type="button"
              onClick={() => addTag(sug)}
              className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand-text)]"
            >
              + {sug}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
