import { WebhooksPage } from "@/components/protected/webhooks/webhooks-page";

// /admin/webhooks (SCR-43): guarded by `ops.webhooks` (lib/nav-main-items.ts); the backend seed gives that key to super_admin only.
export default function WebhooksRoute() {
  return <WebhooksPage />;
}
