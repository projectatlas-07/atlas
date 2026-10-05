"use client";

import { useState } from "react";
import { normalizeSignupOtp } from "@/features/auth/services/signup-service";

type SignupOtpInputProps = Readonly<{
  id: string;
  value: string;
  length: number;
  invalid?: boolean;
  describedBy?: string;
  onValueChange: (value: string) => void;
}>;

/** One real input for paste/autofill, presented as responsive OTP cells. */
export function AuthOtpInput({
  id,
  value,
  length,
  invalid = false,
  describedBy,
  onValueChange,
}: SignupOtpInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="relative flex min-h-atlas-12 w-full gap-atlas-1 sm:gap-atlas-2">
      {/* ui-exception: A transparent native input provides one-time-code autofill and whole-code paste over the visual OTP cells. */}
      <input className="absolute inset-atlas-0 z-10 h-full w-full cursor-text opacity-0"
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        onChange={(event) => onValueChange(normalizeSignupOtp(event.target.value, length))}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
      {Array.from({ length }, (_, index) => {
        const isActive = isFocused && index === Math.min(value.length, length - 1);
        return (
          <span
            key={index}
            aria-hidden="true"
            className={[
              "flex min-h-atlas-12 min-w-0 flex-1 items-center justify-center rounded-atlas-control border bg-atlas-surface",
              "text-atlas-xl font-atlas-semibold text-atlas-text transition-colors",
              invalid ? "border-atlas-danger bg-atlas-danger-surface" : "border-atlas-border-strong",
              isActive ? "border-atlas-primary ring-atlas-focus ring-offset-atlas-focus" : "",
            ].join(" ")}
          >
            {value[index] ?? ""}
          </span>
        );
      })}
    </div>
  );
}

/** Existing signup name retained while recovery shares the same accessible control. */
export const SignupOtpInput = AuthOtpInput;
