import { createElement } from "react";

import type { StatusTone } from "@/lib/statuses";

const TONE_CLASSES = {
  neutral: "border-atlas-border bg-atlas-surface-muted text-atlas-text-muted",
  success: "border-atlas-success-border bg-atlas-success-surface text-atlas-success-text",
  warning: "border-atlas-warning-border bg-atlas-warning-surface text-atlas-warning-text",
  danger: "border-atlas-danger-border bg-atlas-danger-surface text-atlas-danger-text",
  info: "border-atlas-info-border bg-atlas-info-surface text-atlas-info-text",
  archive: "border-atlas-archive-border bg-atlas-archive-surface text-atlas-archive-text",
} as const satisfies Record<StatusTone, string>;

export type StatusPillProps = Readonly<{
  label: string;
  tone: StatusTone;
}>;

/** Presentation-only rendering for a label and its resolved semantic tone. */
export function StatusPill({ label, tone }: StatusPillProps) {
  if (!label.trim()) {
    throw new Error("StatusPill requires a visible label.");
  }

  return createElement(
    "span",
    {
      className: [
        "inline-flex items-center whitespace-nowrap rounded-atlas-pill border px-atlas-2 py-atlas-1",
        "text-atlas-xs font-atlas-semibold",
        TONE_CLASSES[tone],
      ].join(" "),
    },
    label,
  );
}
