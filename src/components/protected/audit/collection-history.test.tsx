import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionHistory, CollectionHistorySheet } from "@/components/protected/audit/collection-history";
import { setAuditCaller } from "@/mocks/mock-audit";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/locales" }));

// The History of a COLLECTION (locales, UI strings, the bundle): `entity_id=0`, the tab shape only, no client-side filter.
describe("CollectionHistory", () => {
  useMockApi();
  beforeEach(() => setAuditCaller(getMockDb(), { "cms.locales": ["read"], "cms.ui_strings": ["read"] }));

  it("asks entity_type + entity_id=0 + limit only, and shows action, actor, time and summary", async () => {
    const seen: string[] = [];
    server.use(http.get("*/api/v1/audit-logs", ({ request }) => { seen.push(new URL(request.url).search); return undefined; }));
    renderApp(<CollectionHistory entityType="cms.locale" />);
    expect(await screen.findByText("cms.locale.updated")).toBeInTheDocument();
    expect(screen.getByText(/locale lo updated: is_active, fallback_code/)).toBeInTheDocument();
    expect(screen.getByText(/Noy Keomany/)).toBeInTheDocument();
    const params = new URLSearchParams(seen[0]);
    expect(params.get("entity_type")).toBe("cms.locale");
    expect(params.get("entity_id")).toBe("0");
    expect([...params.keys()].sort()).toEqual(["entity_id", "entity_type", "limit"]);
  });

  it("the UI strings trail includes the bundle syncs", async () => {
    renderApp(<CollectionHistory entityType="cms.ui_string" />);
    expect(await screen.findByText(/nav.home: restore of v2/)).toBeInTheDocument();
    expect(screen.getAllByText(/bundle 3f9c2ab: inserted=2 source_updated=1 kept_override=4/).length).toBeGreaterThan(0);
  });

  it("without read on the entity the 403 shows the no-permission state", async () => {
    setAuditCaller(getMockDb(), { "iam.users": ["read"] });
    renderApp(<CollectionHistory entityType="cms.locale" />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });

  it("the sheet loads nothing until it is opened", async () => {
    const seen: string[] = [];
    server.use(http.get("*/api/v1/audit-logs", ({ request }) => { seen.push(request.url); return undefined; }));
    renderApp(<CollectionHistorySheet entityType="cms.locale" />);
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toHaveLength(0);
    await userEvent.setup().click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText("cms.locale.updated")).toBeInTheDocument();
    await waitFor(() => expect(seen).toHaveLength(1));
  });
});
