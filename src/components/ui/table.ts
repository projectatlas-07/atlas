import {
  createElement,
  type HTMLAttributes,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";

type WithoutClassName<T> = Readonly<Omit<T, "className">>;

export type TableContainerProps = WithoutClassName<
  HTMLAttributes<HTMLDivElement>
> & Readonly<{
  bounded?: boolean;
}>;

/** Provides the shared surface and horizontal overflow for wide tables. */
export function TableContainer({ children, bounded = false, ...props }: TableContainerProps) {
  return createElement(
    "div",
    {
      ...props,
      className: [
        "w-full rounded-atlas-card border border-atlas-border bg-atlas-surface",
        bounded ? "max-h-96 overflow-auto" : "overflow-x-auto",
      ].join(" "),
    },
    children,
  );
}

export type TableProps = WithoutClassName<
  TableHTMLAttributes<HTMLTableElement>
> &
  Readonly<{
    wide?: boolean;
  }>;

export function Table({ children, wide = false, ...props }: TableProps) {
  return createElement(
    "table",
    {
      ...props,
      className: [
        "w-full border-collapse text-left text-atlas-base text-atlas-text",
        wide ? "min-w-max" : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
    children,
  );
}

export type TableCaptionProps = WithoutClassName<
  HTMLAttributes<HTMLTableCaptionElement>
> &
  Readonly<{
    visuallyHidden?: boolean;
  }>;

export function TableCaption({
  children,
  visuallyHidden = false,
  ...props
}: TableCaptionProps) {
  return createElement(
    "caption",
    {
      ...props,
      className: visuallyHidden
        ? "sr-only"
        : "px-atlas-3 py-atlas-2 text-left text-atlas-sm font-atlas-semibold text-atlas-text",
    },
    children,
  );
}

export type TableHeaderProps = WithoutClassName<
  HTMLAttributes<HTMLTableSectionElement>
> &
  Readonly<{
    sticky?: boolean;
  }>;

export function TableHeader({
  children,
  sticky = false,
  ...props
}: TableHeaderProps) {
  return createElement(
    "thead",
    {
      ...props,
      className: [
        "border-b border-atlas-border bg-atlas-surface-muted text-atlas-text-muted",
        sticky ? "sticky top-0 z-10" : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
    children,
  );
}

export type TableBodyProps = WithoutClassName<
  HTMLAttributes<HTMLTableSectionElement>
>;

export function TableBody({ children, ...props }: TableBodyProps) {
  return createElement(
    "tbody",
    {
      ...props,
      className: "divide-y divide-atlas-border",
    },
    children,
  );
}

export type TableRowProps = WithoutClassName<
  HTMLAttributes<HTMLTableRowElement>
> &
  Readonly<{
    hoverable?: boolean;
    selected?: boolean;
  }>;

export function TableRow({
  children,
  hoverable = false,
  selected = false,
  ...props
}: TableRowProps) {
  return createElement(
    "tr",
    {
      ...props,
      className: [
        selected ? "bg-atlas-primary-surface" : "",
        hoverable ? "transition-colors hover:bg-atlas-surface-hover" : "",
      ].filter(Boolean).join(" ") || undefined,
    },
    children,
  );
}

export type TableHeaderCellProps = WithoutClassName<
  ThHTMLAttributes<HTMLTableCellElement>
> &
  Readonly<{
    numeric?: boolean;
  }>;

export function TableHeaderCell({
  children,
  numeric = false,
  scope = "col",
  ...props
}: TableHeaderCellProps) {
  return createElement(
    "th",
    {
      ...props,
      scope,
      className: [
        "px-atlas-3 py-atlas-2 text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide",
        numeric ? "whitespace-nowrap text-right tabular-nums" : "text-left",
      ].join(" "),
    },
    children,
  );
}

export type TableCellProps = WithoutClassName<
  TdHTMLAttributes<HTMLTableCellElement>
> &
  Readonly<{
    numeric?: boolean;
  }>;

export function TableCell({
  children,
  numeric = false,
  ...props
}: TableCellProps) {
  return createElement(
    "td",
    {
      ...props,
      className: [
        "px-atlas-3 py-atlas-3 align-middle",
        numeric ? "whitespace-nowrap text-right tabular-nums" : "text-left",
      ].join(" "),
    },
    children,
  );
}
