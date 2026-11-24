import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
} from "react";

type FieldSize = "sm" | "md";

const CONTROL_BASE_CLASS =
  "w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:border-[var(--brand)] focus:outline-none disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-[var(--text-muted)] disabled:opacity-75";

const SIZE_CLASSES: Record<FieldSize, string> = {
  md: "px-3 py-2 text-sm",
  sm: "px-2.5 py-1.5 text-[0.8125rem]",
};

export interface FormFieldProps {
  id?: string;
  label: string;
  labelAction?: ReactNode;
  error?: string | null;
  size?: FieldSize;
  className?: string;
  children: ReactNode;
}

export function FormField({
  id,
  label,
  labelAction,
  error,
  size = "md",
  className = "",
  children,
}: FormFieldProps) {
  const labelSizeClass = size === "sm" ? "text-[0.6875rem]" : "text-xs";
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className={`block ${labelSizeClass} font-medium text-[var(--text-secondary)]`}
        >
          {label}
        </label>
        {labelAction}
      </div>
      <div className="mt-1">{children}</div>
      {error && (
        <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>
      )}
    </div>
  );
}

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  inputSize?: FieldSize;
  hasError?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function TextInput({
  inputSize = "md",
  hasError = false,
  className = "",
  ref,
  ...rest
}: TextInputProps) {
  return (
    <input
      ref={ref}
      aria-invalid={hasError || undefined}
      className={`${CONTROL_BASE_CLASS} ${hasError ? "!border-[var(--danger)]" : ""} ${SIZE_CLASSES[inputSize]} ${className}`}
      {...rest}
    />
  );
}

export interface SelectInputProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  selectSize?: FieldSize;
  hasError?: boolean;
  children: ReactNode;
}

export function SelectInput({
  selectSize = "md",
  hasError = false,
  className = "",
  children,
  ...rest
}: SelectInputProps) {
  return (
    <select
      aria-invalid={hasError || undefined}
      className={`${CONTROL_BASE_CLASS} ${hasError ? "!border-[var(--danger)]" : ""} ${SIZE_CLASSES[selectSize]} ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
