// `GET /dashboard/summary` (doc/05 section 13.8; task T1.5.4 is not written yet, so this is built against the mock
// `src/mocks/mock-dashboard.ts`). Every card is optional: the server leaves a card out when the caller may not see it, and the
// UI shows exactly the cards that are present. The first five members are the documented contract; `content_counts`,
// `recent_activity` and `relay` are PROPOSED additions (not in 05 13.8) - the UI treats them as optional too.
import type { UserRef } from "@/types/media";

// The plural revision form of an entity kind.
export type DashboardEntityType = "cms.pages" | "cms.posts" | "cms.albums" | "cms.faq_groups" | "forms.forms";

export type DashboardDraftItem = {
  entity_type: DashboardEntityType;
  id: number;
  title: string;
  status: string;
  has_unpublished_changes: boolean;
  updated_at: string;
};

export type DashboardContentCount = { entity_type: DashboardEntityType; draft: number; published: number };

export type DashboardActivityItem = {
  id: number;
  // The audit action, e.g. `cms.post.updated`.
  action: string;
  entity_type: string;
  entity_id: number | null;
  // A short sentence the server wrote, never user content (for example the title of a page).
  summary: string;
  actor: UserRef;
  created_at: string;
};

export type DashboardSummary = {
  generated_at: string;
  // `forms.manage` / `cms.*` read: my drafts and the drafts I started.
  my_drafts?: { count: number; items: DashboardDraftItem[] };
  // `forms.submissions:read`: equals `GET /submissions/summary`.new.
  submissions_new?: { count: number };
  // `ops.system:read`
  failed_jobs?: { count: number };
  // `cms.locales:read`: every active non-default language.
  translation?: Array<{ locale_code: string; percent: number }>;
  // `media.library:read`
  media_missing_alt?: { count: number };
  // PROPOSED: drafts / published per content kind (what the caller may read).
  content_counts?: DashboardContentCount[];
  // PROPOSED: the latest audit rows (`ops.audit:read`).
  recent_activity?: DashboardActivityItem[];
  // PROPOSED: the outbox relay (`ops.system:read`), the same member names as `GET /system/status` `outbox`.
  relay?: { pending: number; failed: number; last_success_at: string | null; oldest_pending_at: string | null };
};
