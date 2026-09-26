import { createElement, type HTMLAttributes, type ReactNode } from "react";

export const FEEDBACK_TONES = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
] as const;

export type FeedbackTone = (typeof FEEDBACK_TONES)[number];

const TONE_CLASSES = {
  neutral: "border-atlas-border bg-atlas-surface-muted text-atlas-text-muted",
  info: "border-atlas-info-border bg-atlas-info-surface text-atlas-info-text",
  success:
    "border-atlas-success-border bg-atlas-success-surface text-atlas-success-text",
  warning:
    "border-atlas-warning-border bg-atlas-warning-surface text-atlas-warning-text",
  danger:
    "border-atlas-danger-border bg-atlas-danger-surface text-atlas-danger-text",
} as const satisfies Record<FeedbackTone, string>;

export type FeedbackProps = Readonly<
  Omit<HTMLAttributes<HTMLDivElement>, "className"> & {
    tone?: FeedbackTone;
  }
>;

/** Caller-owned message with a semantic presentation tone and optional ARIA role. */
export function Feedback({
  tone = "neutral",
  children,
  ...props
}: FeedbackProps) {
  return createElement(
    "div",
    {
      ...props,
      className: [
        "rounded-atlas-control border p-atlas-3 text-atlas-sm font-atlas-medium",
        TONE_CLASSES[tone],
      ].join(" "),
    },
    children,
  );
}

export type EmptyStateProps = Readonly<
  Omit<HTMLAttributes<HTMLDivElement>, "children" | "className"> & {
    title: ReactNode;
    description?: ReactNode;
    children?: ReactNode;
  }
>;

/** Compact empty-content presentation; callers retain all contextual meaning. */
export function EmptyState({
  title,
  description,
  children,
  ...props
}: EmptyStateProps) {
  return createElement(
    "div",
    {
      ...props,
      className:
        "flex flex-col items-center justify-center px-atlas-4 py-atlas-8 text-center",
    },
    createElement(
      "p",
      { className: "text-atlas-base font-atlas-semibold text-atlas-text" },
      title,
    ),
    description != null
      ? createElement(
          "p",
          { className: "mt-atlas-2 text-atlas-sm text-atlas-text-muted" },
          description,
        )
      : null,
    children != null
      ? createElement(
          "div",
          { className: "mt-atlas-4 flex items-center justify-center" },
          children,
        )
      : null,
  );
}
