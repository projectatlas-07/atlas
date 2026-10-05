import { z } from "zod";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";

/** Atlas V1 app-side minimum. Supabase Test remains at its lower dashboard minimum. */
export const AUTH_PASSWORD_MIN_LENGTH = 12;

export const signupFormSchema = z.object({
  email: z.string().trim()
    .min(1, ATLAS_UI_STRINGS.auth.emailRequired)
    .email(ATLAS_UI_STRINGS.auth.emailInvalid),
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

export const pendingEmailSchema = z.string().trim()
  .min(1, ATLAS_UI_STRINGS.auth.emailRequired)
  .email(ATLAS_UI_STRINGS.auth.emailInvalid);

export type SignupFormValues = z.infer<typeof signupFormSchema>;
