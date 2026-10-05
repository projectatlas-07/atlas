import {
  Children,
  createElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

export const BUTTON_VARIANTS = [
  "primary",
  "secondary",
  "ghost",
  "danger",
] as const;

export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

const VARIANT_CLASSES = {
  primary:
    "border-atlas-primary bg-atlas-primary text-atlas-primary-foreground hover:bg-atlas-primary-hover active:border-atlas-primary-hover active:bg-atlas-primary-hover",
  secondary:
    "border-atlas-border-strong bg-atlas-surface text-atlas-text hover:bg-atlas-surface-hover active:border-atlas-primary-border active:bg-atlas-primary-surface active:text-atlas-primary",
  ghost:
    "border-transparent bg-transparent text-atlas-text hover:bg-atlas-surface-hover active:bg-atlas-primary-surface active:text-atlas-primary",
  danger:
    "border-atlas-danger-border bg-atlas-danger-surface text-atlas-danger-text hover:border-atlas-danger hover:text-atlas-danger active:bg-atlas-danger active:text-atlas-text-inverse",
} as const satisfies Record<ButtonVariant, string>;

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
>;

export type ButtonProps = Readonly<
  NativeButtonProps & {
    variant?: ButtonVariant;
    fullWidth?: boolean;
    loading?: boolean;
    loadingLabel?: ReactNode;
  }
>;

function hasVisibleText(node: ReactNode): boolean {
  return Children.toArray(node).some((child) => {
    if (typeof child === "string") {
      return child.trim().length > 0;
    }

    if (typeof child === "number") {
      return true;
    }

    if (!isValidElement<{ children?: ReactNode }>(child)) {
      return false;
    }

    if (child.type === "svg") {
      return false;
    }

    return hasVisibleText(child.props.children);
  });
}

/** Shared presentation and interaction states for Atlas actions. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  children,
  variant = "primary",
  fullWidth = false,
  type = "button",
  disabled = false,
  loading = false,
  loadingLabel,
  onClick,
  "aria-busy": ariaBusy,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}, ref) {
  if (children == null) {
    throw new Error("Button requires visible content.");
  }

  const hasAccessibleLabel = Boolean(
    (typeof ariaLabel === "string" && ariaLabel.trim()) ||
      (typeof ariaLabelledBy === "string" && ariaLabelledBy.trim()),
  );

  if (!hasVisibleText(children) && !hasAccessibleLabel) {
    throw new Error("Icon-only Button requires an accessible label.");
  }

  const isUnavailable = disabled || loading;
  const showsLoadingLabel = loading && loadingLabel != null;

  return createElement(
    "button",
    {
      ...props,
      ref,
      type,
      disabled: isUnavailable,
      onClick: isUnavailable ? undefined : onClick,
      "aria-busy": loading ? true : ariaBusy,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      className: [
        "relative inline-flex min-h-atlas-12 items-center justify-center gap-atlas-2 whitespace-nowrap rounded-atlas-button border px-atlas-4 py-atlas-2",
        "text-atlas-base font-atlas-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus",
        "disabled:cursor-not-allowed disabled:border-atlas-border disabled:bg-atlas-surface-disabled disabled:text-atlas-text-disabled",
        fullWidth ? "w-full" : "",
        VARIANT_CLASSES[variant],
      ].join(" "),
    },
    createElement(
      "span",
      { className: showsLoadingLabel ? "invisible" : undefined },
      children,
    ),
    showsLoadingLabel
      ? createElement(
          "span",
          {
            className:
              "absolute inset-atlas-0 flex items-center justify-center px-atlas-4",
            "aria-live": "polite",
          },
          loadingLabel,
        )
      : null,
  );
});
