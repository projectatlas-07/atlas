import {
  createElement,
  type LabelHTMLAttributes,
  type ReactNode,
} from "react";

type NativeLabelProps = Omit<
  LabelHTMLAttributes<HTMLLabelElement>,
  "children" | "className"
>;

export type FormFieldProps = Readonly<
  NativeLabelProps & {
    label: ReactNode;
    children: ReactNode;
  }
>;

/** Shared label-and-control composition; validation and business meaning stay with callers. */
export function FormField({ label, children, ...props }: FormFieldProps) {
  return createElement(
    "label",
    {
      ...props,
      className: "block text-atlas-sm font-atlas-medium text-atlas-text-muted",
    },
    createElement("span", { className: "mb-atlas-1 block" }, label),
    children,
  );
}
