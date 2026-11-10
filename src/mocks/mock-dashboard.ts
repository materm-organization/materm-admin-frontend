// The dashboard summary (`GET /dashboard/summary`, doc/05 section 13.8, task T1.5.4 - the backend does not exist yet). EVERYTHING that
// stands in for it is in this one file (plus the typed hook `hooks/use-dashboard.ts` and the wire type `types/dashboard.d.ts`), so
// that aligning with the real endpoint later is one place: change the shape in `types/dashboard.d.ts`, the numbers here.
//
// The numbers are COMPUTED from the other mock models (pages, posts, forms, submissions, media), never typed in, so they agree with
// the screens: `submissions_new.count` is the `new` of `GET /submissions/summary`; "my drafts" are the things the signed-in user
// started that are still drafts or have a pending draft. The documented members are `generated_at`, `my_drafts`, `submissions_new`,
// `failed_jobs`, `translation`, `media_missing_alt`; `content_counts`, `recent_activity` and `relay` are PROPOSED additions.
//
// The real server leaves out the cards the caller may not see. This mock cannot know the caller (the browser mock and the tests keep
// the user elsewhere), so it returns every card unless `setDashboardCards(db, { omit: [...] })` leaves some out - the UI shows exactly
// the cards that are in the answer.
import { DEFAULT_LOCALE_CODE, MOCK_ACTIVE_LOCALE_CODES, MOCK_USER, keyOf, type MockDb, type StoredRevision } from "@/mocks/mock-core";
import { formDraftRow, formWorking, formsState } from "@/mocks/mock-forms";
import { queueCounts } from "@/mocks/mock-publishing-queue";
import { newCount } from "@/mocks/mock-submissions";
import type { DashboardActivityItem, DashboardContentCount, DashboardDraftItem, DashboardEntityType, DashboardSummary } from "@/types/dashboard";
import type { UserRef } from "@/types/media";

type CardKey = Exclude<keyof DashboardSummary, "generated_at">;

type DashboardState = {
  omit: Set<CardKey>;
  failedJobs: number;
  relay: { pending: number; failed: number };
  // The server is down: the request fails (the page shows `ErrorState`).
  fail: boolean;
};

const states = new WeakMap<MockDb, DashboardState>();
const stateOf = (db: MockDb): DashboardState => {
  let s = states.get(db);
  if (!s) {
    s = { omit: new Set(), failedJobs: 2, relay: { pending: 3, failed: 0 }, fail: false };
    states.set(db, s);
  }
  return s;
};

export function setDashboardCards(db: MockDb, options: { omit?: CardKey[]; failedJobs?: number; relay?: { pending: number; failed: number }; fail?: boolean }) {
  const s = stateOf(db);
  if (options.omit) s.omit = new Set(options.omit);
  if (options.failedJobs !== undefined) s.failedJobs = options.failedJobs;
  if (options.relay) s.relay = options.relay;
  if (options.fail !== undefined) s.fail = options.fail;
}
export const dashboardFails = (db: MockDb) => stateOf(db).fail;

// ---- what the other models hold, read loosely (the albums / FAQ models are written by another task and may change shape) ----------
type Root = { id: number; status: string; deleted_at?: string | null; created_by?: UserRef; updated_at: string };
type Kind = { type: DashboardEntityType; resource: string; roots: Array<Root>; title: (root: Root) => string };

function kinds(db: MockDb): Kind[] {
  const loose = db as unknown as { albums?: Array<Root & { live?: { translations?: Array<{ locale_code: string; title?: string }> } }>; faqGroups?: Array<Root & { live?: { group?: { name?: string } } }> };
  return [
    {
      type: "cms.pages",
      resource: "pages",
      roots: db.pages,
      title: (r) => {
        const page = db.pages.find((p) => p.id === r.id)!;
        return (page.live.translations.find((t) => t.locale_code === DEFAULT_LOCALE_CODE) ?? page.live.translations[0])?.title ?? page.live.page.name;
      },
    },
    {
      type: "cms.posts",
      resource: "posts",
      roots: db.posts,
      title: (r) => {
        const post = db.posts.find((p) => p.id === r.id)!;
        return (post.live.translations.find((t) => t.locale_code === DEFAULT_LOCALE_CODE) ?? post.live.translations[0])?.title ?? `#${r.id}`;
      },
    },
    {
      type: "cms.albums",
      resource: "albums",
      roots: loose.albums ?? [],
      title: (r) => (loose.albums ?? []).find((a) => a.id === r.id)?.live?.translations?.find((t) => t.locale_code === DEFAULT_LOCALE_CODE)?.title ?? `#${r.id}`,
    },
    {
      type: "cms.faq_groups",
      resource: "faq-groups",
      roots: loose.faqGroups ?? [],
      title: (r) => (loose.faqGroups ?? []).find((g) => g.id === r.id)?.live?.group?.name ?? `#${r.id}`,
    },
    {
      type: "forms.forms",
      resource: "forms",
      roots: formsState(db).forms,
      title: (r) => {
        const form = formsState(db).forms.find((f) => f.id === r.id)!;
        return formWorking(db, form).form.name;
      },
    },
  ];
}

const draftRowOf = (db: MockDb, kind: Kind, root: Root): StoredRevision | undefined => {
  if (kind.resource === "forms") return formDraftRow(db, formsState(db).forms.find((f) => f.id === root.id)!);
  return (db.revisions[keyOf(kind.resource, root.id)] ?? []).find((r) => r.kind === "draft");
};

function myDrafts(db: MockDb): NonNullable<DashboardSummary["my_drafts"]> {
  const items: DashboardDraftItem[] = [];
  for (const kind of kinds(db)) {
    for (const root of kind.roots) {
      if (root.deleted_at) continue;
      const draft = draftRowOf(db, kind, root);
      const mineAsDraft = root.status === "draft" && root.created_by?.id === MOCK_USER.id;
      const minePending = root.status === "published" && draft?.created_by?.id === MOCK_USER.id;
      if (!mineAsDraft && !minePending) continue;
      items.push({ entity_type: kind.type, id: root.id, title: kind.title(root), status: root.status, has_unpublished_changes: Boolean(minePending), updated_at: root.updated_at });
    }
  }
  items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { count: items.length, items: items.slice(0, 5) };
}

function contentCounts(db: MockDb): DashboardContentCount[] {
  return kinds(db).map((kind) => {
    const live = kind.roots.filter((r) => !r.deleted_at);
    return { entity_type: kind.type, draft: live.filter((r) => r.status !== "published").length, published: live.filter((r) => r.status === "published").length };
  });
}

// Percent of the texts of every published page / post that exist in a language (title, SEO title and description; posts also the excerpt).
function translation(db: MockDb): NonNullable<DashboardSummary["translation"]> {
  const out: NonNullable<DashboardSummary["translation"]> = [];
  for (const code of MOCK_ACTIVE_LOCALE_CODES) {
    if (code === DEFAULT_LOCALE_CODE) continue;
    let total = 0;
    let filled = 0;
    const count = (...values: Array<string | null | undefined>) => {
      for (const v of values) {
        total += 1;
        if (v && v.trim()) filled += 1;
      }
    };
    for (const page of db.pages.filter((p) => p.status === "published" && !p.deleted_at)) {
      const t = page.live.translations.find((x) => x.locale_code === code);
      count(t?.title, t?.seo_title, t?.seo_description);
    }
    for (const post of db.posts.filter((p) => p.status === "published" && !p.deleted_at)) {
      const t = post.live.translations.find((x) => x.locale_code === code);
      count(t?.title, t?.excerpt, t?.seo_title, t?.seo_description);
    }
    out.push({ locale_code: code, percent: total === 0 ? 100 : Math.round((100 * filled) / total) });
  }
  return out;
}

const SINGULAR: Record<string, string> = { "cms.pages": "cms.page", "cms.posts": "cms.post", "forms.forms": "forms.form", "media.assets": "media.asset" };
const NOUN: Record<string, string> = { "cms.pages": "Page", "cms.posts": "Post", "forms.forms": "Form", "media.assets": "Media file" };

// The latest audit-like rows, built from the revisions the models hold (a revision is the trace of an edit or a publish).
function recentActivity(db: MockDb): DashboardActivityItem[] {
  const rows: DashboardActivityItem[] = [];
  for (const list of Object.values(db.revisions)) {
    for (const rev of list) {
      if (rev.is_preview || rev.schema_version > 1 || !SINGULAR[rev.entity.type]) continue;
      const verb = rev.kind === "published" ? "published" : rev.kind === "restore" ? "restored" : "updated";
      rows.push({
        id: rev.id,
        action: `${SINGULAR[rev.entity.type]}.${verb}`,
        entity_type: SINGULAR[rev.entity.type],
        entity_id: rev.entity.id,
        summary: `${NOUN[rev.entity.type]} #${rev.entity.id} ${verb}`,
        actor: rev.created_by,
        created_at: rev.created_at,
      });
    }
  }
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, 8);
}

function missingAlt(db: MockDb): number {
  return db.assets.filter((a) => !a.deleted_at && !a.is_decorative && !(a.translations[DEFAULT_LOCALE_CODE]?.alt ?? "").trim()).length;
}

export function dashboardSummary(db: MockDb): DashboardSummary {
  const state = stateOf(db);
  const queue = queueCounts(db);
  const all: Omit<DashboardSummary, "generated_at"> = {
    in_review: { count: queue.in_review },
    scheduled_7d: { count: queue.scheduled_7d },
    my_drafts: myDrafts(db),
    submissions_new: { count: newCount(db) },
    failed_jobs: { count: state.failedJobs },
    translation: translation(db),
    media_missing_alt: { count: missingAlt(db) },
    content_counts: contentCounts(db),
    recent_activity: recentActivity(db),
    relay: { pending: state.relay.pending, failed: state.relay.failed, last_success_at: new Date(db.clock - 30_000).toISOString(), oldest_pending_at: state.relay.pending > 0 ? new Date(db.clock - 90_000).toISOString() : null },
  };
  const out: DashboardSummary = { generated_at: new Date(db.clock).toISOString() };
  for (const [key, value] of Object.entries(all) as Array<[CardKey, never]>) if (!state.omit.has(key)) (out as Record<string, unknown>)[key] = value;
  return out;
}
