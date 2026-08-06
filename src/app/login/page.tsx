"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";

const loginFormSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

export default function LoginPage() {
  const router = useRouter();
  const isSigningInRef = useRef(false);
  const [authenticationError, setAuthenticationError] = useState("");
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<LoginFormValues>({
    defaultValues: { email: "", password: "" },
  });

  async function signIn(values: LoginFormValues) {
    if (isSigningInRef.current) return;

    const parsed = loginFormSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      if (fieldErrors.email?.[0]) setError("email", { message: fieldErrors.email[0] });
      if (fieldErrors.password?.[0]) setError("password", { message: fieldErrors.password[0] });
      return;
    }

    isSigningInRef.current = true;
    setAuthenticationError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (error) {
        setAuthenticationError(error.message);
        return;
      }

      router.replace("/");
      router.refresh();
    } catch (error) {
      setAuthenticationError(error instanceof Error ? error.message : "Sign-in failed. Please try again.");
    } finally {
      isSigningInRef.current = false;
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-orange-700">Atlas</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">Enter your account details to continue.</p>

        <form className="mt-7 space-y-5" noValidate onSubmit={handleSubmit(signIn)}>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              {...register("email", { onChange: () => setAuthenticationError("") })}
              type="email"
              inputMode="email"
              autoComplete="email"
              className="mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-4 text-base text-slate-950 outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
            />
          </label>
          {errors.email && <p role="alert" className="text-sm font-medium text-red-700">{errors.email.message}</p>}

          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              {...register("password", { onChange: () => setAuthenticationError("") })}
              type="password"
              autoComplete="current-password"
              className="mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-4 text-base text-slate-950 outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
            />
          </label>
          {errors.password && <p role="alert" className="text-sm font-medium text-red-700">{errors.password.message}</p>}

          {authenticationError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{authenticationError}</p>}

          <button type="submit" disabled={isSubmitting} className="h-12 w-full rounded-xl bg-orange-700 px-5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
