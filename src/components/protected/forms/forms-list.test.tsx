import { screen, within } from "@testing-library/react";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormsList } from "@/components/protected/forms/forms-list";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";

const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/forms",
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const rowOf = async (name: string) => {
  const table = await screen.findByRole("table");
  const cell = (await within(table).findAllByText(name))[0];
  return cell.closest("tr") as HTMLElement;
};

beforeEach(() => {
  nav.search = "";
  nav.push.mockReset();
});

describe("FormsList (SCR-31)", () => {
  useMockApi();

  it("lists the forms with the state, the number of active recipients and the new messages; there is no create button", async () => {
    renderApp(<FormsList />);
    const contact = await rowOf("Contact form");
    expect(within(contact).getByRole("link", { name: "Contact form" })).toHaveAttribute("href", "/admin/forms/1");
    expect(within(contact).getByText(/contact - system form/)).toBeInTheDocument();
    expect(within(contact).getByTestId("status-badge")).toHaveTextContent("Published");
    expect(within(contact).getByTestId("no-recipients")).toHaveTextContent("No recipients");
    expect(within(contact).getByRole("link", { name: "5 new" })).toHaveAttribute("href", "/admin/forms/submissions?form_id=1&status=new");
    const trek = await rowOf("Trek booking (2027 season)");
    expect(within(trek).getByTestId("status-badge")).toHaveTextContent("Published, changes pending");
    expect(within(trek).getByText("3")).toBeInTheDocument();
    const news = await rowOf("Newsletter");
    expect(within(news).getByTestId("status-badge")).toHaveTextContent("Draft only");
    expect(within(news).getByText("0")).toBeInTheDocument();
    expect(screen.getByText("3 in total")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create|new form/i })).not.toBeInTheDocument();
  });

  it("filters come from the URL and go to the API as they are", async () => {
    nav.search = "status=draft&keyword=news";
    const seen: string[] = [];
    server.use(http.get("*/api/v1/forms", ({ request }) => {
      seen.push(new URL(request.url).search);
      return undefined;
    }));
    renderApp(<FormsList />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Newsletter");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(seen[0]).toContain("status=draft");
    expect(seen[0]).toContain("keyword=news");
    expect(seen[0]).toContain("sort=slug");
  });

  it("without the right to read forms the list is the no-permission state", async () => {
    server.use(http.get("*/api/v1/forms", () => Response.json({ success: false, code: "FORBIDDEN", message: "x" }, { status: 403 })));
    renderApp(<FormsList />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });
});
