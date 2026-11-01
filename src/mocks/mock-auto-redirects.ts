// The automatic 301 redirects of a publish that moves a published page's path or a published post's slug (doc/05 14.12),
// as the publish mocks answer them: the redirect row is really created (so the Redirects screen and the mock graph see
// it) and the answer carries `auto_redirect_created`; an old address that an editor's redirect already holds is
// `auto_redirect_skipped` with `reason: "source_taken"` (nothing is written). Other skip reasons come from the real
// server only (loop, chain_too_long, internal_error need its graph and database).
import { createRedirect } from "@/mocks/mock-redirects";
import type { MockDb } from "@/mocks/mock-db";
import type { PublishIssue } from "@/types/publishing";

export type PathMove = { warningPath: string; source: string; target: string; localeCode: string | null; kind: "page" | "post" };

// `locale_code: null` (every language) is what the server sends; PublishIssue's params type has no null, hence the cast.
const params = (p: Record<string, unknown>) => p as PublishIssue["params"];

export function autoRedirectWarnings(db: MockDb, moves: PathMove[]): PublishIssue[] {
  const out: PublishIssue[] = [];
  for (const m of moves) {
    const taken = db.redirects.find((r) => !r.deleted_at && r.source_path === m.source && (r.locale_code ?? "") === (m.localeCode ?? ""));
    if (taken) {
      out.push({
        path: m.warningPath,
        code: "auto_redirect_skipped",
        params: params({ reason: "source_taken", redirect_id: taken.id, existing_target: taken.target, source_path: m.source, target: m.target, locale_code: m.localeCode }),
      });
      continue;
    }
    try {
      const created = createRedirect(db, { source_path: m.source, target: m.target, status_code: 301, locale_code: m.localeCode, note: `auto: ${m.kind} ${m.kind === "page" ? "path" : "slug"} changed` });
      out.push({
        path: m.warningPath,
        code: "auto_redirect_created",
        params: params({ redirect_id: created.data.id, source_path: m.source, target: m.target, locale_code: m.localeCode, hops: 1 }),
      });
    } catch {
      out.push({ path: m.warningPath, code: "auto_redirect_skipped", params: params({ reason: "internal_error", source_path: m.source, target: m.target, locale_code: m.localeCode }) });
    }
  }
  return out;
}
