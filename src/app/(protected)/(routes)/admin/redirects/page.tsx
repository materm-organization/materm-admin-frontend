import { RedirectsPage } from "@/components/protected/redirects/redirects-page";

// /admin/redirects (SCR-42): guarded by `cms.redirects` (lib/nav-main-items.ts).
export default function RedirectsRoute() {
  return <RedirectsPage />;
}
