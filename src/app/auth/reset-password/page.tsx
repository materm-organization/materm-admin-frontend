import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

// SCR-03 — public. The e-mailed link is `/auth/reset-password#token=…`; the token is in the URL fragment and is
// read (and removed from the address bar) on the client only.
export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <ResetPasswordForm />
    </AuthShell>
  );
}
