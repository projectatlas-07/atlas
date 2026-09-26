import { createElement, type HTMLAttributes } from "react";

export const CARD_SURFACES = ["default", "muted"] as const;

export type CardSurface = (typeof CARD_SURFACES)[number];
export type CardElement = "div" | "section" | "article";

export type CardProps = Readonly<
  Omit<HTMLAttributes<HTMLElement>, "className"> & {
    as?: CardElement;
    surface?: CardSurface;
  }
>;

const SURFACE_CLASSES = {
  default: "bg-atlas-surface",
  muted: "bg-atlas-surface-muted",
} as const satisfies Record<CardSurface, string>;

/** Restrained grouped-content surface; interaction belongs to semantic children. */
export function Card({
  as = "div",
  surface = "default",
  children,
  ...props
}: CardProps) {
  return createElement(
    as,
    {
      ...props,
      className: [
        "rounded-atlas-card border border-atlas-border p-atlas-4 text-atlas-text",
        SURFACE_CLASSES[surface],
      ].join(" "),
    },
    children,
  );
}
