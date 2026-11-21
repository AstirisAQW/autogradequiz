"use client";

import { Dialog } from "@/components/ui/Dialog";

const SHORTCUTS = [
  { label: "Select answer choice A–E", keys: "A / B / C / D / E" },
  { label: "Mark focused question as Blank", keys: "Backspace" },
  { label: "Previous / next flagged question", keys: "↑ / ↓" },
  { label: "Previous / next paper in queue", keys: "← / →" },
  { label: "Save corrections and advance", keys: "Enter" },
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
      <dl className="divide-y divide-[var(--border-hairline)] rounded-[8px] border border-[var(--border-hairline)] text-[13px]">
        {SHORTCUTS.map((item) => (
          <div
            key={item.keys}
            className="flex items-center justify-between px-3.5 py-2.5"
          >
            <dt className="text-[var(--text-primary)]">{item.label}</dt>
            <dd className="font-mono text-[12px] font-semibold text-[var(--text-secondary)]">
              {item.keys}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
