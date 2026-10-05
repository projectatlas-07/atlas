import { createElement, type HTMLAttributes } from "react";

export const CARD_SURFACES = ["default", "muted"] as const;
export const CARD_PADDINGS = ["default", "comfortable"] as const;

export type CardSurface = (typeof CARD_SURFACES)[number];
export type CardPadding = (typeof CARD_PADDINGS)[number];
export type CardElement = "div" | "section" | "article";

export type CardProps = Readonly<
  Omit<HTMLAttributes<HTMLElement>, "className"> & {
    as?: CardElement;
    surface?: CardSurface;
    padding?: CardPadding;
  }
>;

const SURFACE_CLASSES = {
  default: "bg-atlas-surface",
  muted: "bg-atlas-surface-muted",
} as const satisfies Record<CardSurface, string>;

const PADDING_CLASSES = {
  default: "p-atlas-4",
  comfortable: "p-atlas-6 sm:p-atlas-8",
} as const satisfies Record<CardPadding, string>;

/** Restrained grouped-content surface; interaction belongs to semantic children. */
export function Card({
  as = "div",
  surface = "default",
  padding = "default",
  children,
  ...props
}: CardProps) {
  return createElement(
    as,
    {
      ...props,
      className: [
        "rounded-atlas-card border border-atlas-border text-atlas-text",
        SURFACE_CLASSES[surface],
        PADDING_CLASSES[padding],
      ].join(" "),
    },
    children,
  );
}
