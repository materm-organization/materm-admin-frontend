import { AuthorsPage } from "@/components/protected/authors/authors-page";

// /admin/blog/authors (SCR-27): guarded by `cms.blog` (lib/nav-main-items.ts).
export default function AuthorsRoute() {
  return <AuthorsPage />;
}
