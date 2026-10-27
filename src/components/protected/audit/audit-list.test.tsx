import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuditList } from "@/components/protected/audit/audit-list";
import { buildAuditQuery } from "@/services/audit.api";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "http://localhost:3000/api/v1";

const me = vi.hoisted(() => ({ current: { id: 1, roleID: 1, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/admin/audit",
    useRouter: () => ({ push: nav.push, replace: nav.push }),
    useSearchParams: () => React.useMemo(() => new URLSearchParams(nav.search), []),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const entry = (id: number, over: Record<string, unknown> = {}) => ({
  id, occurred_at: "2026-10-27T03:00:00Z", actor_type: "user", actor_user_id: 1, actor_name: "admin01", actor_role_key: null, api_key_id: null,
  action: "iam.role.permissions_updated", result: "success", entity_type: "iam.role", entity_id: 3, entity_public_id: null,
  summary: "Editor grants updated", ip: "203.0.113.5", user_agent: "Mozilla/5.0", request_id: "0192d3a4-aaaa", has_changes: true, ...over,
});

let queries: URLSearchParams[] = [];
let detailQueries: URLSearchParams[] = [];
beforeEach(() => {
  nav.search = "";
  nav.push.mockReset();
  queries = [];
  detailQueries = [];
  me.current = { id: 1, roleID: 1, permissions: grants({ "ops.audit": ["read"], "iam.users": ["read"] }) };
  server.use(
    http.get(`${API}/users`, () =>
      HttpResponse.json({ success: true, data: [{ id: 1, name: "Admin", username: "admin01" }], meta: { total: 1, page: 1, limit: 100, total_page: 1 } })
    ),
    http.get(`${API}/audit-logs`, ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json({ success: true, data: [entry(11), entry(12, { result: "denied", has_changes: false, action: "authz.denied" })], meta: { total: 2, page: 1, limit: 10, total_page: 1 } });
    }),
    http.get(`${API}/audit-logs/11`, ({ request }) => {
      detailQueries.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        success: true,
        data: {
          ...entry(11),
          before: { "cms.blog": ["read"], "iam.users": ["read"] },
          after: { "cms.blog": ["read", "create"], "iam.users": ["read"] },
          changes: [{ op: "replace", path: "/cms.blog", value: ["read", "create"] }],
        },
      });
    })
  );
});

describe("buildAuditQuery: only what GET /audit-logs accepts", () => {
  it("drops keyword and unknown keys, empty values, and an entity_id without entity_type", () => {
    expect(
      buildAuditQuery({
        page: 1, limit: 10, sort: "-occurred_at", entity_id: 5, action: "", request_id: undefined,
        ...({ keyword: "x", foo: "y" } as object),
      })
    ).toEqual({ page: 1, limit: 10, sort: "-occurred_at" });
    expect(buildAuditQuery({ entity_type: "iam.user", entity_id: 5 })).toEqual({ entity_type: "iam.user", entity_id: 5 });
  });
});

describe("AuditList (SCR-11)", () => {
  it("lists events newest first with a result badge, a changes icon, and no keyword box", async () => {
    renderApp(<AuditList />);
    expect(await screen.findByText("iam.role.permissions_updated")).toBeInTheDocument();
    expect(queries[0].get("sort")).toBe("-occurred_at");
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Success")).toBeInTheDocument();
    expect(table.getByText("Denied")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Has before/after values" })).toHaveLength(1);
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("a hand-typed ?keyword= (and other unknown keys) never reach the API; dates become UTC bounds", async () => {
    nav.search = "keyword=abc&foo=1&from=2026-10-01&to=2026-10-27&action=iam.user.*&result=denied&entity_id=4";
    renderApp(<AuditList />);
    await screen.findByText("iam.role.permissions_updated");
    const q = queries[0];
    expect(q.has("keyword")).toBe(false);
    expect(q.has("foo")).toBe(false);
    expect(q.get("from")).toBe("2026-09-30T17:00:00.000Z");
    expect(q.get("to")).toBe("2026-10-27T17:00:00.000Z");
    expect(q.get("action")).toBe("iam.user.*");
    expect(q.get("result")).toBe("denied");
    // entity_id without entity_type is invalid for the endpoint: dropped.
    expect(q.has("entity_id")).toBe(false);
  });

  it("Apply commits all filters to the URL in one step", async () => {
    const u = userEvent.setup();
    renderApp(<AuditList />);
    await screen.findByText("iam.role.permissions_updated");
    await u.type(screen.getByLabelText("Action"), "iam.role.*");
    await u.click(screen.getByRole("combobox", { name: "Result" }));
    await u.click(await screen.findByRole("option", { name: "Denied" }));
    await u.type(screen.getByLabelText("Item type"), "iam.role");
    await u.type(screen.getByLabelText("Item id"), "3");
    await u.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(nav.push).toHaveBeenCalledTimes(1);
    const url = new URL(`http://x${nav.push.mock.calls[0][0]}`);
    expect(url.pathname).toBe("/admin/audit");
    expect(url.searchParams.get("action")).toBe("iam.role.*");
    expect(url.searchParams.get("result")).toBe("denied");
    expect(url.searchParams.get("entity_type")).toBe("iam.role");
    expect(url.searchParams.get("entity_id")).toBe("3");
  });

  it("an item id without an item type is refused before any request", async () => {
    const u = userEvent.setup();
    renderApp(<AuditList />);
    await screen.findByText("iam.role.permissions_updated");
    await u.type(screen.getByLabelText("Item id"), "3");
    await u.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("An item id needs an item type.")).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("a shared link with a range wider than 92 days and no narrow filter says so and sends no request", async () => {
    nav.search = "from=2025-01-01&to=2026-10-27";
    renderApp(<AuditList />);
    expect(await screen.findByText(/can be at most 92 days/)).toBeInTheDocument();
    expect(queries).toHaveLength(0);
  });

  it("the same wide range is fine with a narrow filter (24 months)", async () => {
    nav.search = "from=2025-01-01&to=2026-10-27&action=iam.user.*";
    renderApp(<AuditList />);
    await screen.findByText("iam.role.permissions_updated");
    expect(queries).toHaveLength(1);
  });

  it("a click on the time opens the drawer: the detail is read with occurred_at and shows a before/after diff", async () => {
    const u = userEvent.setup();
    renderApp(<AuditList />);
    const rows = await screen.findAllByRole("button", { name: /Oct 27, 2026/ });
    await u.click(rows[0]);
    const drawer = await screen.findByRole("dialog");
    await waitFor(() => expect(detailQueries).toHaveLength(1));
    expect(detailQueries[0].get("occurred_at")).toBe("2026-10-27T03:00:00Z");
    const diff = await within(drawer).findByTestId("audit-diff");
    const changed = within(diff).getByText("cms.blog").closest("tr") as HTMLElement;
    expect(within(changed).getByText('["read"]')).toBeInTheDocument();
    expect(within(changed).getByText('["read","create"]')).toBeInTheDocument();
    // The unchanged key is not listed.
    expect(within(diff).queryByText("iam.users")).not.toBeInTheDocument();
    expect(within(drawer).getByText("JSON Patch from the server")).toBeInTheDocument();
  });

  it("'All events of this request' filters the list by request_id", async () => {
    const u = userEvent.setup();
    renderApp(<AuditList />);
    await u.click((await screen.findAllByRole("button", { name: /Oct 27, 2026/ }))[0]);
    const drawer = await screen.findByRole("dialog");
    await u.click(await within(drawer).findByRole("button", { name: "All events of this request" }));
    expect(nav.push).toHaveBeenCalledWith("/admin/audit?request_id=0192d3a4-aaaa", { scroll: false });
  });

  it("an event without recorded changes says so and does not fetch a diff table", async () => {
    const u = userEvent.setup();
    renderApp(<AuditList />);
    const rows = await screen.findAllByRole("button", { name: /Oct 27, 2026/ });
    await u.click(rows[1]);
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("This event has no recorded before/after values.")).toBeInTheDocument();
  });

  it("403 shows the no-permission state", async () => {
    server.use(http.get(`${API}/audit-logs`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    renderApp(<AuditList />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });

  it("a user without iam.users:read types the actor id; the users list is never requested", async () => {
    me.current = { id: 1, roleID: 1, permissions: grants({ "ops.audit": ["read"] }) };
    let userCalls = 0;
    server.use(http.get(`${API}/users`, () => { userCalls += 1; return HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 }); }));
    renderApp(<AuditList />);
    await screen.findByText("iam.role.permissions_updated");
    expect(userCalls).toBe(0);
    expect(screen.getByLabelText("Actor")).toHaveAttribute("placeholder", "User id");
  });
});
