import { screen, waitFor } from "@testing-library/react";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserHistory } from "@/components/protected/users/user-history";
import { setAuditCaller } from "@/mocks/mock-audit";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const me = vi.hoisted(() => ({ current: { id: 1, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/users/1" }));

// The History tab of a user for a caller WITHOUT `ops.audit:read`: it must send only the tab shape (anything more is a 403).
describe("UserHistory", () => {
  useMockApi();
  beforeEach(() => {
    me.current = { id: 2, roleID: 2, permissions: grants({ "iam.users": ["read"] }) };
    setAuditCaller(getMockDb(), { "iam.users": ["read"] });
  });

  it("shows the trail with read on iam.users only and sends nothing but entity_type, entity_id and limit", async () => {
    const seen: string[] = [];
    server.use(
      http.get("*/api/v1/audit-logs", ({ request }) => {
        seen.push(new URL(request.url).search);
        return undefined;
      })
    );
    renderApp(<UserHistory userId={1} />);
    expect(await screen.findByText("iam.user.created")).toBeInTheDocument();
    expect(seen).toHaveLength(1);
    expect([...new URLSearchParams(seen[0]).keys()].sort()).toEqual(["entity_id", "entity_type", "limit"]);
    // no link to the full log without ops.audit:read
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("without read on iam.users the 403 shows the no-permission state, not an empty list", async () => {
    setAuditCaller(getMockDb(), { "cms.pages": ["read"] });
    renderApp(<UserHistory userId={1} />);
    await waitFor(() => expect(screen.queryByText("iam.user.created")).not.toBeInTheDocument());
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });
});
