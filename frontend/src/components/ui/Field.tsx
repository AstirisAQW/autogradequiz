import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

type FieldSize = "sm" | "md";

const CONTROL_BASE_CLASS =
  "w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:border-[var(--brand)] focus:outline-none disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-[var(--text-muted)] disabled:opacity-75";

const SIZE_CLASSES: Record<FieldSize, string> = {
  md: "px-3 py-2 text-[14px]",
  sm: "px-2.5 py-1.5 text-[13px]",
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
  const labelSizeClass = size === "sm" ? "text-[11px]" : "text-[12px]";
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
        <p className="mt-1 text-[12px] text-[var(--danger)]">{error}</p>
      )}
    </div>
  );
}

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  inputSize?: FieldSize;
}

export function TextInput({
  inputSize = "md",
  className = "",
  ...rest
}: TextInputProps) {
  return (
    <input
      className={`${CONTROL_BASE_CLASS} ${SIZE_CLASSES[inputSize]} ${className}`}
      {...rest}
    />
  );
}

export interface SelectInputProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  selectSize?: FieldSize;
  children: ReactNode;
}

export function SelectInput({
  selectSize = "md",
  className = "",
  children,
  ...rest
}: SelectInputProps) {
  return (
    <select
      className={`${CONTROL_BASE_CLASS} ${SIZE_CLASSES[selectSize]} ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
