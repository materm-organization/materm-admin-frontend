import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { SystemStatusView } from "@/components/protected/system/system-status";
import { SYSTEM_STATUS_REFETCH_MS, systemRefetchInterval } from "@/hooks/use-system";
import { apiError, networkError } from "@/test/api-error";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";

const API = "http://localhost:3000/api/v1";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/system" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The cache purge card asks the signed-in user for `ops.system:execute` (read-only here: the card stays hidden).
vi.mock("@/hooks/use-auth", () => ({
  useFetchCurrentUser: () => ({
    data: { data: { id: 1, roleID: 2, permissions: [{ id: 1, permission_key: "ops.system", name: "System", description: "", category: "ops", actions: ["read"] }] } },
  }),
}));

const STATUS = {
  status: "degraded",
  service: { name: "materm-admin-backend", version: "0.1.0", commit: "3f9c2ab", environment: "production", started_at: "2026-10-21T01:02:03Z", uptime_seconds: 90061, server_time: "2026-10-22T02:03:04Z" },
  dependencies: [
    { name: "database", status: "ok", latency_ms: 3, checked_at: "x", error_code: null },
    { name: "redis", status: "ok", latency_ms: 1, checked_at: "x", error_code: null },
    { name: "file_store", status: "not_configured", latency_ms: null, checked_at: "x", error_code: null },
    { name: "mailer", status: "down", latency_ms: null, checked_at: "x", error_code: "connection_refused" },
  ],
  counters: { login_failed: 1204, authz_denied: 3 },
};

describe("systemRefetchInterval: polling every 30 s, but never after a no-permission read", () => {
  it("keeps polling when healthy or after a 5xx / network error; stops after 403 and auth errors", () => {
    expect(systemRefetchInterval(null)).toBe(SYSTEM_STATUS_REFETCH_MS);
    expect(systemRefetchInterval(apiError(500))).toBe(SYSTEM_STATUS_REFETCH_MS);
    expect(systemRefetchInterval(networkError())).toBe(SYSTEM_STATUS_REFETCH_MS);
    expect(systemRefetchInterval(apiError(403, { code: "FORBIDDEN" }))).toBe(false);
    expect(systemRefetchInterval(apiError(401, { code: "UNAUTHENTICATED" }))).toBe(false);
  });
});

describe("SystemStatusView (SCR-45)", () => {
  it("shows the overall state, the service facts, the four dependencies and the counters", async () => {
    server.use(http.get(`${API}/system/status`, () => HttpResponse.json({ success: true, data: STATUS })));
    renderApp(<SystemStatusView />);
    const overall = await screen.findByRole("status");
    expect(overall).toHaveTextContent("Degraded");
    expect(screen.getByText("3f9c2ab")).toBeInTheDocument();
    expect(screen.getByText("1d 1h 1m")).toBeInTheDocument();
    const deps = within(screen.getByText("Dependencies").closest("[data-slot=card]") as HTMLElement);
    expect(deps.getByText("Database").closest("li")).toHaveTextContent("OK");
    // Not configured is its own (grey) state, not a failure.
    expect(deps.getByText("File store").closest("li")).toHaveTextContent("Not configured");
    expect(deps.getByText("Mailer").closest("li")).toHaveTextContent("Down");
    expect(deps.getByText("connection refused")).toBeInTheDocument();
    expect(screen.getByText("Failed sign-ins").nextSibling).toHaveTextContent("1,204");
  });

  it("an unknown counter / dependency name is shown as it is", async () => {
    server.use(
      http.get(`${API}/system/status`, () =>
        HttpResponse.json({ success: true, data: { ...STATUS, counters: { brand_new: 7 }, dependencies: [{ name: "queue", status: "ok", latency_ms: 2, checked_at: "x", error_code: null }] } })
      )
    );
    renderApp(<SystemStatusView />);
    expect(await screen.findByText("brand_new")).toBeInTheDocument();
    expect(screen.getByText("queue")).toBeInTheDocument();
  });

  it("403 shows the no-permission state", async () => {
    server.use(http.get(`${API}/system/status`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    renderApp(<SystemStatusView />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });

  it("a 5xx shows the error state with a retry", async () => {
    server.use(http.get(`${API}/system/status`, () => HttpResponse.json({ success: false, code: "INTERNAL_ERROR", request_id: "req-1" }, { status: 500 })));
    renderApp(<SystemStatusView />);
    expect(await screen.findByText("Could not load this")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
