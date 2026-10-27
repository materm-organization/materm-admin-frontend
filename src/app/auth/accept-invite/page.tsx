import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { AuthShell } from "@/components/auth/auth-shell";

// SCR-04 — public. The e-mailed link is `/auth/accept-invite#token=…` (token in the URL fragment).
export default function AcceptInvitePage() {
  return (
    <AuthShell>
      <AcceptInviteForm />
    </AuthShell>
  );
}
