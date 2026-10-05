import { AuthShell } from "@/features/auth/components/auth-shell";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export function AccountAccessDisabled() {
  return (
    <AuthShell
      title={ATLAS_UI_STRINGS.auth.accessDisabledTitle}
      description={ATLAS_UI_STRINGS.auth.accessDisabledDescription}
    >
      <p className="text-atlas-sm text-atlas-text-muted">
        {ATLAS_UI_STRINGS.auth.accessDisabledHelp}
      </p>
      <div className="mt-atlas-6">
        <LogoutButton v2 fullWidth />
      </div>
    </AuthShell>
  );
}
