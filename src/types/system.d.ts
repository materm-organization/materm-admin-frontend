// GET /system/status (doc/05-api-spec.md section 4.3).
export type OverallStatus = "ok" | "degraded" | "down";
export type DependencyStatus = "ok" | "degraded" | "down" | "not_configured";

export type SystemDependency = {
  name: string;
  status: DependencyStatus;
  latency_ms: number | null;
  checked_at: string;
  error_code: string | null;
};

export type SystemStatus = {
  status: OverallStatus;
  service: {
    name: string;
    version: string;
    commit: string;
    environment: string;
    started_at: string;
    server_time: string;
    uptime_seconds: number;
  };
  dependencies: SystemDependency[];
  counters: Record<string, number>;
  // Additive, P1 (doc/05 section 4.3): not on the P0 backend.
  outbox?: { pending?: number; failed?: number; last_success_at?: string | null } | null;
};

// POST /system/cache/purge (doc/05 section 11.8). `tags` only with scope "tags" (1..50, the public allow-list).
export type CachePurgeScope = "tags" | "all";

export type CachePurgePayload =
  | { scope: "tags"; tags: string[]; reason?: string }
  | { scope: "all"; reason?: string };

export type CachePurgeResult = {
  event_id: number;
  scope: CachePurgeScope;
  // What was really queued (the server adds the paired tags: `page:3` -> `pages`); `["*"]` for scope "all".
  tags: string[];
  status: "queued";
  queued_at: string;
};
