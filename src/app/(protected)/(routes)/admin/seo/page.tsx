import { SeoPage } from "@/components/protected/seo/seo-page";

// /admin/seo (SCR-16): the `seo` settings group, guarded by `cms.seo` (lib/nav-main-items.ts).
export default function SeoRoute() {
  return <SeoPage />;
}
