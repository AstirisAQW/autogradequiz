"use client";

import { Dialog } from "@/components/ui/Dialog";

const SHORTCUTS = [
  { label: "Select choice for focused question", keys: "A to E" },
  { label: "Mark focused question blank", keys: "Backspace" },
  { label: "Move between flagged questions", keys: "Up / Down arrow" },
  { label: "Previous or next paper in queue", keys: "Left / Right arrow" },
  { label: "Save and open next paper", keys: "Enter" },
  { label: "Toggle shortcuts reference", keys: "?" },
] as const;

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  return (
    <Dialog
      open={open}
      title="Keyboard shortcuts"
      description="Use your keyboard in the Review queue to resolve flagged questions without touching the mouse."
      cancelLabel="Close"
      onClose={onClose}
    >
      <dl className="divide-y divide-[var(--border-hairline)] rounded-lg border border-[var(--border-hairline)] text-[0.8125rem]">
        {SHORTCUTS.map((item) => (
          <div
            key={item.keys}
            className="flex items-center justify-between px-3.5 py-2.5"
          >
            <dt className="text-[var(--text-primary)]">{item.label}</dt>
            <dd className="font-mono text-xs font-semibold text-[var(--text-secondary)]">
              {item.keys}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
