"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, type InputProps } from "@/components/ui/form-controls";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type PasswordFieldProps = Readonly<Omit<InputProps, "type" | "withTrailingAction"> & {
  label: string;
  error?: string;
  help?: string;
}>;

export function PasswordField({
  id,
  label,
  error,
  help,
  "aria-describedby": ariaDescribedBy,
  ...inputProps
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const toggleLabel = isVisible
    ? ATLAS_UI_STRINGS.auth.hidePassword
    : ATLAS_UI_STRINGS.auth.showPassword;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [ariaDescribedBy, helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-atlas-2 block text-atlas-sm font-atlas-medium text-atlas-text">
        {label}
      </label>
      <div className="relative">
        <Input
          {...inputProps}
          id={id}
          type={isVisible ? "text" : "password"}
          withTrailingAction
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
        <div className="absolute inset-y-atlas-0 right-atlas-0 flex items-center">
          <Button
            type="button"
            variant="ghost"
            aria-label={`${toggleLabel}: ${label}`}
            aria-pressed={isVisible}
            onClick={() => setIsVisible((visible) => !visible)}
          >
            {isVisible ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        </div>
      </div>
      {help && !error && (
        <p id={helpId} className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" className="h-atlas-5 w-atlas-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.04 12.32a1.01 1.01 0 0 1 0-.64C3.42 7.51 7.36 4.5 12 4.5s8.57 3.01 9.96 7.18c.07.21.07.43 0 .64C20.58 16.49 16.64 19.5 12 19.5S3.42 16.49 2.04 12.32Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" className="h-atlas-5 w-atlas-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.22A10.48 10.48 0 0 0 1.93 12C3.23 16.34 7.24 19.5 12 19.5c.99 0 1.95-.14 2.86-.4M6.23 6.23A10.45 10.45 0 0 1 12 4.5c4.76 0 8.77 3.16 10.07 7.5a10.52 10.52 0 0 1-4.3 5.77M6.23 6.23 3 3m3.23 3.23 3.65 3.65m7.89 7.89L21 21m-3.23-3.23-3.65-3.65m0 0a3 3 0 1 0-4.24-4.24m4.24 4.24L9.88 9.88" />
    </svg>
  );
}
