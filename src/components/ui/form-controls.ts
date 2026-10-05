import {
  createElement,
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

type WithoutClassName<T> = Readonly<Omit<T, "className">>;

const BASE_CONTROL_CLASSES = [
  "min-h-atlas-12 w-full min-w-0 rounded-atlas-control border px-atlas-3 py-atlas-2",
  "bg-atlas-surface text-atlas-base font-atlas-regular text-atlas-text",
  "transition-colors placeholder:text-atlas-text-subtle",
  "focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus",
].join(" ");

const INTERACTIVE_CLASSES =
  "border-atlas-border-strong hover:border-atlas-primary-border";

const DISABLED_CLASSES =
  "cursor-not-allowed border-atlas-border bg-atlas-surface-disabled text-atlas-text-disabled";

const READ_ONLY_CLASSES =
  "cursor-default border-atlas-border bg-atlas-surface-muted text-atlas-text-muted";

const INVALID_CLASSES =
  "border-atlas-danger bg-atlas-danger-surface text-atlas-text hover:border-atlas-danger";

function isInvalid(value: InputHTMLAttributes<HTMLInputElement>["aria-invalid"]) {
  return value === true || (typeof value === "string" && value !== "false");
}

function controlStateClasses({
  disabled,
  readOnly,
  ariaInvalid,
}: Readonly<{
  disabled: boolean;
  readOnly: boolean;
  ariaInvalid: InputHTMLAttributes<HTMLInputElement>["aria-invalid"];
}>) {
  if (disabled) return DISABLED_CLASSES;
  if (readOnly) return READ_ONLY_CLASSES;
  if (isInvalid(ariaInvalid)) return INVALID_CLASSES;
  return INTERACTIVE_CLASSES;
}

export type InputProps = WithoutClassName<
  InputHTMLAttributes<HTMLInputElement>
> & {
  withTrailingAction?: boolean;
};

/** Native Atlas input styling. Labels and validation rules remain with callers. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    type = "text",
    disabled = false,
    readOnly = false,
    withTrailingAction = false,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  return createElement("input", {
    ...props,
    ref,
    type,
    disabled,
    readOnly,
    "aria-invalid": ariaInvalid,
    className: [
      BASE_CONTROL_CLASSES,
      withTrailingAction ? "pr-atlas-16" : "",
      controlStateClasses({ disabled, readOnly, ariaInvalid }),
    ].join(" "),
  });
});

export type SelectProps = WithoutClassName<
  SelectHTMLAttributes<HTMLSelectElement>
>;

/** Native Atlas select styling; searchable comboboxes remain separate controls. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    children,
    disabled = false,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  return createElement(
    "select",
    {
      ...props,
      ref,
      disabled,
      "aria-invalid": ariaInvalid,
      className: [
        BASE_CONTROL_CLASSES,
        controlStateClasses({
          disabled,
          readOnly: false,
          ariaInvalid,
        }),
      ].join(" "),
    },
    children,
  );
});

export type TextareaProps = WithoutClassName<
  TextareaHTMLAttributes<HTMLTextAreaElement>
>;

/** Native Atlas multiline input styling. Labels and validation rules remain with callers. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    disabled = false,
    readOnly = false,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  return createElement("textarea", {
    ...props,
    ref,
    disabled,
    readOnly,
    "aria-invalid": ariaInvalid,
    className: [
      BASE_CONTROL_CLASSES,
      "resize-y",
      controlStateClasses({ disabled, readOnly, ariaInvalid }),
    ].join(" "),
  });
});

export type CheckboxProps = WithoutClassName<
  Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "readOnly">
>;

/** Native checkbox semantics with the compact Atlas selection treatment. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { disabled = false, ...props },
  ref,
) {
  return createElement("input", {
    ...props,
    ref,
    type: "checkbox",
    disabled,
    className: [
      "h-atlas-5 w-atlas-5 shrink-0 cursor-pointer accent-atlas-primary",
      "focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus",
      "disabled:cursor-not-allowed disabled:opacity-60",
    ].join(" "),
  });
});
