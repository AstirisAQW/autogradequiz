"use client";

import { useRef, useState } from "react";

export interface DropzoneProps {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  label?: string;
  hint?: string;
  onFiles: (files: File[]) => void;
}

export function Dropzone({
  accept = "image/png,image/jpeg",
  multiple = true,
  disabled = false,
  disabledReason,
  label = "Drop answer sheet images here, or click to browse",
  hint = "PNG or JPEG files",
  onFiles,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFileList(list: FileList | null) {
    if (!list || list.length === 0 || disabled) return;
    onFiles(Array.from(list));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      title={disabled && disabledReason ? disabledReason : undefined}
      onClick={() => {
        if (!disabled) inputRef.current?.click();
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFileList(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-6 py-8 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
        disabled
          ? "cursor-not-allowed border-[var(--border-hairline)] bg-[var(--bg-subtle)] opacity-60"
          : dragging
            ? "border-[var(--brand)] bg-[var(--brand-subtle)]"
            : "border-[var(--border-strong)] bg-[var(--bg-surface)] hover:border-[var(--brand)] hover:bg-[var(--bg-subtle)]/50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => handleFileList(e.target.files)}
        className="sr-only"
      />
      <p className="text-sm font-medium text-[var(--text-primary)]">
        {label}
      </p>
      <p className="text-xs text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}
