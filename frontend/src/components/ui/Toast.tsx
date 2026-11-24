"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastActionOptions {
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  durationMs?: number;
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

interface ToastContextValue {
  push: (
    message: string,
    tone?: ToastTone,
    options?: ToastActionOptions,
  ) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASSES: Record<ToastTone, string> = {
  success:
    "border-emerald-700/20 bg-[var(--success-bg)] text-[var(--success-text)]",
  error: "border-red-700/20 bg-[var(--danger-bg)] text-[var(--danger-text)]",
  info: "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const push = useCallback(
    (
      message: string,
      tone: ToastTone = "info",
      options?: ToastActionOptions,
    ) => {
      nextIdRef.current += 1;
      const id = nextIdRef.current;
      const durationMs =
        options?.durationMs ?? (options?.actionLabel ? 6500 : 4000);
      setItems((prev) => [
        ...prev,
        {
          id,
          tone,
          message,
          actionLabel: options?.actionLabel,
          onAction: options?.onAction,
        },
      ]);
      const timer = window.setTimeout(() => dismiss(id), durationMs);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed right-6 bottom-6 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`pointer-events-auto flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-sm ${TONE_CLASSES[item.tone]}`}
          >
            <span>{item.message}</span>
            <div className="flex shrink-0 items-center gap-2">
              {item.actionLabel && item.onAction && (
                <button
                  type="button"
                  onClick={() => {
                    const fn = item.onAction;
                    dismiss(item.id);
                    if (fn) void fn();
                  }}
                  className="rounded-md border border-current/25 bg-black/5 px-2.5 py-1 text-xs font-semibold underline-offset-2 hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                >
                  {item.actionLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="rounded px-1.5 py-1 text-xs font-medium opacity-80 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
