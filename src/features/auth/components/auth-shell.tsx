import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

type AuthShellProps = Readonly<{
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
}>;

/** Shared presentation shell for the small Atlas Authentication V2 flow. */
export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-atlas-background px-atlas-4 py-atlas-8 font-atlas text-atlas-text sm:px-atlas-5">
      <div className="flex w-full max-w-md flex-col items-center">
        <div className="mb-atlas-6 flex select-none items-baseline gap-atlas-2" aria-label="Atlas Office">
          <span className="text-atlas-2xl font-atlas-semibold tracking-tight text-atlas-text">
            Atlas
          </span>
          <span className="text-atlas-xs font-atlas-medium uppercase tracking-atlas-wide text-atlas-text-muted">
            Office
          </span>
        </div>

        <Card as="section" padding="comfortable" aria-labelledby="auth-page-title">
          <header className="mb-atlas-8">
            <h1 id="auth-page-title" className="text-atlas-3xl font-atlas-semibold tracking-tight text-atlas-text">
              {title}
            </h1>
            <p className="mt-atlas-2 text-atlas-base font-atlas-regular text-atlas-text-muted">
              {description}
            </p>
          </header>
          {children}
        </Card>
      </div>
    </main>
  );
}
