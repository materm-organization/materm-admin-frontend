// Preview-link wire types (doc/05 section 12.9, doc/api/openapi-admin.yaml: CreatePreviewLinkRequest, PreviewLinkCreated,
// PreviewLinkItem, PreviewLinkRevoked). A link is frozen at the working copy of the moment it was issued.
import type { UserRef } from "@/types/media";

export type PreviewLinkState = "active" | "expired" | "revoked";
export type PreviewLinkStateFilter = PreviewLinkState | "all";

export type PreviewRevisionRef = {
  id: number;
  version: number;
  // The moment of the snapshot the link shows.
  frozen_at: string;
};

// POST body; both fields optional (server defaults: the default language, 30 minutes). `ttl_minutes` is 1..1440.
export type CreatePreviewLinkPayload = {
  locale?: string;
  ttl_minutes?: number;
};

// The answer of the POST. `url` holds the raw token and exists ONLY in this one answer (`Cache-Control: no-store`);
// it must never reach a query cache, storage, a log or the admin app's own URL.
export type PreviewLinkCreated = {
  id: number;
  url: string;
  expires_at: string;
  locale: string;
  entity: { type: string; id: number };
  revision: PreviewRevisionRef;
};

// A row of the list: never has the url / token (the server keeps only a hash).
export type PreviewLinkItem = {
  id: number;
  locale: string | null;
  state: PreviewLinkState;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  use_count: number;
  revision: PreviewRevisionRef;
  // The page was edited after `frozen_at`: the link shows an older version than the working copy.
  is_stale: boolean;
  created_by: UserRef;
};

export type PreviewLinksQuery = {
  state?: PreviewLinkStateFilter;
  page?: number;
  limit?: number;
  sort?: "-created_at" | "created_at" | "expires_at" | "-expires_at";
};

export type PreviewLinkRevoked = {
  id: number;
  state: "revoked";
  revoked_at: string;
};
