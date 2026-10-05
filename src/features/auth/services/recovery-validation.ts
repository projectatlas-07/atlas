import { z } from "zod";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";
import { AUTH_PASSWORD_MIN_LENGTH } from "./signup-validation.ts";

export const recoveryEmailSchema = z.string().trim()
  .min(1, ATLAS_UI_STRINGS.auth.emailRequired)
  .email(ATLAS_UI_STRINGS.auth.emailInvalid);

export const recoveryPasswordSchema = z.object({
  password: z.string()
    .min(1, ATLAS_UI_STRINGS.auth.passwordRequired)
    .min(AUTH_PASSWORD_MIN_LENGTH, ATLAS_UI_STRINGS.auth.passwordTooShort),
  confirmPassword: z.string().min(1, ATLAS_UI_STRINGS.auth.passwordMismatch),
}).superRefine((values, context) => {
  if (values.password !== values.confirmPassword) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmPassword"],
      message: ATLAS_UI_STRINGS.auth.passwordMismatch,
    });
  }
});

export type RecoveryPasswordValues = z.infer<typeof recoveryPasswordSchema>;
