import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebhooksPage } from "@/components/protected/webhooks/webhooks-page";
import { getMockDb } from "@/mocks/mock-db";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/webhooks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "ops.webhooks": ["read", "create", "update", "delete", "execute"] });
beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: FULL };
  nav.search = "";
  Object.values(toast).forEach((fn) => fn.mockReset());
});
const hooks = () => getMockDb().webhooks;
const rowText = (text: string) => within(screen.getByRole("table")).getAllByRole("row").find((r) => r.textContent?.includes(text))!;

// The whole state React Query keeps: queries (data) and mutations (variables, data). A one-time secret must be in none of it.
function cacheDump(qc: ReturnType<typeof renderApp>["queryClient"]) {
  return JSON.stringify([qc.getQueryCache().getAll().map((q) => [q.queryKey, q.state.data]), qc.getMutationCache().getAll().map((m) => [m.state.variables, m.state.data])], (_k, v) => (typeof v === "function" ? "fn" : v));
}

describe("WebhooksPage (SCR-43)", () => {
  useMockApi();

  it("lists the webhooks newest first with the address, human event names, the status and the failures", async () => {
    renderApp(<WebhooksPage />);
    await screen.findByText("CRM sync");
    const names = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
    expect(names[0]).toContain("Backup mirror");
    expect(names[2]).toContain("CRM sync");
    const crm = rowText("CRM sync");
    expect(crm).toHaveTextContent("https://hooks.example.com/materm");
    expect(crm).toHaveTextContent("Content published");
    expect(crm).toHaveTextContent("Form submitted");
    expect(within(crm).getByTestId("webhook-status")).toHaveAttribute("data-state", "active");
    expect(crm).not.toHaveTextContent("content.published");
    expect(within(rowText("Backup mirror")).getByTestId("webhook-status")).toHaveAttribute("data-state", "inactive");
    expect(within(rowText("Backup mirror")).getAllByRole("cell")[4]).toHaveTextContent("Never");
  });

  it("a webhook the system switched off is marked 'Switched off after 24 hours of failures' with its failures, and can be turned back on with its etag", async () => {
    const user = userEvent.setup();
    const seen: Array<{ body: unknown; ifMatch: string | null }> = [];
    server.use(http.patch(`${API}/webhooks/:id`, async ({ request }) => { seen.push({ body: await request.clone().json(), ifMatch: request.headers.get("If-Match") }); return undefined; }));
    renderApp(<WebhooksPage />);
    await screen.findByText("Slack relay");
    const slack = rowText("Slack relay");
    expect(within(slack).getByTestId("webhook-status")).toHaveTextContent("Switched off after 24 hours of failures");
    expect(within(slack).getAllByRole("cell")[3]).toHaveTextContent("31");
    await user.click(within(slack).getByRole("button", { name: "Turn Slack relay back on" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Webhook turned back on."));
    expect(seen).toEqual([{ body: { is_active: true }, ifMatch: expect.stringMatching(/^"2-[0-9a-f]{8}"$/) }]);
    expect(hooks().rows.find((r) => r.id === 2)).toMatchObject({ is_active: true, disabled_reason: null, consecutive_failures: 0 });
    await waitFor(() => expect(within(rowText("Slack relay")).getByTestId("webhook-status")).toHaveAttribute("data-state", "active"));
  });

  it("filters by the URL state: switched off, and event", async () => {
    nav.search = "is_active=false";
    const { unmount } = renderApp(<WebhooksPage />);
    await screen.findByText("Slack relay");
    expect(screen.queryByText("CRM sync")).toBeNull();
    unmount();
    nav.search = "event=media.ready";
    renderApp(<WebhooksPage />);
    await screen.findByText("Backup mirror");
    expect(screen.queryByText("CRM sync")).toBeNull();
    expect(screen.queryByText("Slack relay")).toBeNull();
  });

  it("a reader sees the table and the deliveries button, nothing that writes or sends", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "ops.webhooks": ["read"] }) };
    renderApp(<WebhooksPage />);
    await screen.findByText("CRM sync");
    expect(screen.getByRole("button", { name: "Deliveries of CRM sync" })).toBeInTheDocument();
    for (const name of [/^New webhook/, /^Edit /, /^Delete /, /^Rotate the secret/, /^Send a test/, /back on$/]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByRole("button", { name: "CRM sync" })).toBeNull();
  });

  it("create: the name, address and an event are required before anything is sent", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(http.post(`${API}/webhooks`, async ({ request }) => { bodies.push(await request.clone().json()); return undefined; }));
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "New webhook" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    expect(await within(dialog).findByText("Enter a name.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter the address.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose at least one event.")).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it.each([
    ["http://hooks.example.org/a", "Only addresses that start with https:// are allowed."],
    ["https://user:pw@hooks.example.org/a", "The address must not contain a user name or password."],
    ["https://hooks.example.org:8443/a", "This port is not allowed. Allowed: 443."],
    ["https://localhost/a", "This name cannot be used (for example localhost or an internal name)."],
    ["https://10.0.0.5/a", "This address points to a private or internal network and cannot be used."],
    ["https://nope.invalid/a", "This address could not be found. Check the spelling."],
    ["nonsense", "This is not a valid web address."],
  ])("create: the server's refusal of %s is shown at the address field in plain words, with no address in it", async (url, message) => {
    const user = userEvent.setup();
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "New webhook" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "Receiver");
    await user.type(within(dialog).getByLabelText(/^Address/), url);
    await user.click(within(dialog).getByRole("checkbox", { name: /^File ready/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    const alert = await within(dialog).findByText(message);
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(hooks().rows).toHaveLength(3);
    expect(screen.queryByText("Webhook secret")).toBeNull();
  });

  it("create: unknown events and a duplicate come back at /events/<i> and a bad timeout at the timeout field", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/webhooks`, () =>
        HttpResponse.json(
          { success: false, code: "VALIDATION_FAILED", message: "x", errors: [{ in: "body", path: "/events/1", code: "unknown_value", params: { allowed: ["a"] } }, { in: "body", path: "/timeout_ms", code: "out_of_range", params: { min: 1000, max: 10000 } }] },
          { status: 422 }
        )
      )
    );
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "New webhook" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "R");
    await user.type(within(dialog).getByLabelText(/^Address/), "https://hooks.example.org/a");
    await user.click(within(dialog).getByRole("checkbox", { name: /^File ready/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    expect(await within(dialog).findByText("One of the events is not valid. Choose from the list.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter a number from 1000 to 10000.")).toBeInTheDocument();
  });

  it("create: the secret is shown ONCE in its own dialog, never reaches the query or mutation cache, and is gone after Done (only the last 4 stay)", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const idem: Array<string | null> = [];
    server.use(http.post(`${API}/webhooks`, async ({ request }) => { bodies.push(await request.clone().json()); idem.push(request.headers.get("Idempotency-Key")); return undefined; }));
    const { queryClient } = renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "New webhook" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "  Receiver ");
    await user.type(within(dialog).getByLabelText(/^Address/), "https://hooks.example.org/a");
    await user.click(within(dialog).getByRole("checkbox", { name: /^File ready/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /^User created/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create webhook" }));

    const secretDialog = await screen.findByRole("dialog", { name: /Webhook secret/ });
    const input = within(secretDialog).getByLabelText("Signing secret") as HTMLInputElement;
    expect(input.value).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(within(secretDialog).getByText(/shown only once/)).toBeInTheDocument();
    expect(within(secretDialog).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(bodies).toEqual([{ name: "Receiver", url: "https://hooks.example.org/a", events: ["media.ready", "user.created"], is_active: true, timeout_ms: 5000 }]);
    expect(idem[0]).toMatch(/^[0-9a-f-]{36}$/);
    // not in any cache while the dialog is open ...
    expect(cacheDump(queryClient)).not.toContain(input.value);
    const secret = input.value;
    // ... Esc does not dismiss it ...
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: /Webhook secret/ })).toBeInTheDocument();
    await user.click(within(secretDialog).getByRole("button", { name: "Done" }));
    // ... and after Done it is nowhere: not in the page, not in the caches, and the list shows only the hint
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Webhook secret/ })).toBeNull());
    expect(document.body.innerHTML).not.toContain(secret);
    expect(cacheDump(queryClient)).not.toContain(secret);
    expect(JSON.stringify(hooks().rows)).not.toContain(secret);
    await screen.findByText("Receiver");
    expect(toast.success).toHaveBeenCalledWith("Webhook created.");
  });

  it("create without the server's secret key (503 security.webhookSecretKey) says webhooks are not configured and creates nothing", async () => {
    const user = userEvent.setup();
    hooks().unconfigured = true;
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "New webhook" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "R");
    await user.type(within(dialog).getByLabelText(/^Address/), "https://hooks.example.org/a");
    await user.click(within(dialog).getByRole("checkbox", { name: /^File ready/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    expect(await within(dialog).findByTestId("webhook-not-configured")).toHaveTextContent("Webhooks are not configured on the server");
    expect(hooks().rows).toHaveLength(3);
  });

  it("a replayed create (secret null) says the secret was already shown, with nothing to copy", async () => {
    const user = userEvent.setup();
    server.use(http.post(`${API}/webhooks`, () => HttpResponse.json({ success: true, data: { ...hooks().rows[0], etag: '"1-x"', secret: null } }, { status: 201 })));
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "New webhook" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "R");
    await user.type(within(dialog).getByLabelText(/^Address/), "https://hooks.example.org/a");
    await user.click(within(dialog).getByRole("checkbox", { name: /^File ready/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    const secretDialog = await screen.findByRole("dialog", { name: /Webhook secret/ });
    expect(within(secretDialog).getByText(/already shown/)).toBeInTheDocument();
    expect(within(secretDialog).queryByRole("button", { name: "Copy" })).toBeNull();
  });

  it("edit: loads the row's own ETag, sends only the change with If-Match, shows the hint (last 4) and no secret", async () => {
    const user = userEvent.setup();
    const seen: Array<{ body: unknown; ifMatch: string | null }> = [];
    server.use(http.patch(`${API}/webhooks/:id`, async ({ request }) => { seen.push({ body: await request.clone().json(), ifMatch: request.headers.get("If-Match") }); return undefined; }));
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Edit CRM sync" }));
    const dialog = await screen.findByRole("dialog");
    const name = await within(dialog).findByLabelText(/^Name/);
    expect(within(dialog).getByTestId("webhook-secret-hint")).toHaveTextContent("••••ab12");
    expect(dialog.textContent).not.toContain("whsec_");
    await user.clear(name);
    await user.type(name, "CRM two");
    await user.clear(within(dialog).getByLabelText(/^Time to wait/));
    await user.type(within(dialog).getByLabelText(/^Time to wait/), "7000");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved."));
    expect(seen).toEqual([{ body: { name: "CRM two", timeout_ms: 7000 }, ifMatch: expect.stringMatching(/^"1-[0-9a-f]{8}"$/) }]);
    expect(hooks().rows[0]).toMatchObject({ name: "CRM two", timeout_ms: 7000 });
  });

  it("edit: a change made by someone else meanwhile opens the conflict dialog (the hash etag moved)", async () => {
    const user = userEvent.setup();
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Edit CRM sync" }));
    const dialog = await screen.findByRole("dialog");
    const name = await within(dialog).findByLabelText(/^Name/);
    hooks().rows[0].name = "Changed elsewhere";
    await user.clear(name);
    await user.type(name, "Mine");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/changed by someone else|changed this/i)).toBeInTheDocument();
    expect(hooks().rows[0].name).toBe("Changed elsewhere");
  });

  it("edit: a statistic the worker writes meanwhile does NOT cause a conflict", async () => {
    const user = userEvent.setup();
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Edit CRM sync" }));
    const dialog = await screen.findByRole("dialog");
    const name = await within(dialog).findByLabelText(/^Name/);
    hooks().rows[0].consecutive_failures = 4;
    hooks().rows[0].last_success_at = "2026-11-03T09:00:00.000009+07:00";
    await user.clear(name);
    await user.type(name, "Still fine");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved."));
    expect(hooks().rows[0].name).toBe("Still fine");
  });

  it("the dialog of a system-switched-off webhook explains it and offers Turn back on", async () => {
    const user = userEvent.setup();
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Edit Slack relay" }));
    const dialog = await screen.findByRole("dialog");
    const banner = await within(dialog).findByTestId("webhook-auto-disabled");
    expect(banner).toHaveTextContent("Switched off after 24 hours of failures");
    expect(banner).toHaveTextContent("31 failures in a row");
    await user.click(within(banner).getByRole("button", { name: "Turn back on" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Webhook turned back on."));
    await waitFor(() => expect(within(dialog).queryByTestId("webhook-auto-disabled")).toBeNull());
  });

  it("rotate: asks first, then shows the NEW secret once; the old hint is replaced and the secret is in no cache", async () => {
    const user = userEvent.setup();
    const ifMatch: Array<string | null> = [];
    server.use(http.post(`${API}/webhooks/:id/rotate-secret`, ({ request }) => { ifMatch.push(request.headers.get("If-Match")); return undefined; }));
    const { queryClient } = renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Rotate the secret of CRM sync" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("The old secret stops working at once");
    expect(ifMatch).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Rotate secret" }));
    const secretDialog = await screen.findByRole("dialog", { name: /New webhook secret/ });
    const secret = (within(secretDialog).getByLabelText("Signing secret") as HTMLInputElement).value;
    expect(secret).toMatch(/^whsec_/);
    expect(ifMatch[0]).toMatch(/^"1-/);
    expect(cacheDump(queryClient)).not.toContain(secret);
    await user.click(within(secretDialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /New webhook secret/ })).toBeNull());
    expect(document.body.innerHTML).not.toContain(secret);
    expect(hooks().rows[0].secret_hint).toBe(secret.slice(-4));
    expect(cacheDump(queryClient)).not.toContain(secret);
  });

  it("rotate without the server's secret key says webhooks are not configured", async () => {
    const user = userEvent.setup();
    hooks().unconfigured = true;
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Rotate the secret of CRM sync" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Rotate secret" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Webhooks are not configured on the server")));
    expect(screen.queryByRole("dialog", { name: /secret/ })).toBeNull();
  });

  it("delete: confirm, then DELETE with If-Match; the row is gone and there is no trash", async () => {
    const user = userEvent.setup();
    const ifMatch: Array<string | null> = [];
    server.use(http.delete(`${API}/webhooks/:id`, ({ request }) => { ifMatch.push(request.headers.get("If-Match")); return undefined; }));
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Delete Backup mirror" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("There is no trash");
    await user.click(within(confirm).getByRole("button", { name: "Delete webhook" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Webhook deleted."));
    expect(ifMatch[0]).toMatch(/^"3-[0-9a-f]{8}"$/);
    await waitFor(() => expect(screen.queryByText("Backup mirror")).toBeNull());
    expect(screen.queryByRole("switch", { name: /trash/i })).toBeNull();
  });

  it("test: nothing is sent until the button is pressed; an ok answer shows the code, the time and the snippet", async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(http.post(`${API}/webhooks/:id/test`, () => { calls++; return undefined; }));
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Send a test to CRM sync" }));
    const dialog = await screen.findByTestId("webhook-test-dialog");
    expect(within(dialog).getByTestId("webhook-test-url")).toHaveTextContent("https://hooks.example.com/materm");
    expect(calls).toBe(0);
    await user.click(within(dialog).getByRole("button", { name: "Send test" }));
    const result = await within(dialog).findByTestId("webhook-test-result");
    expect(result).toHaveAttribute("data-ok", "true");
    expect(within(result).getByTestId("webhook-test-status-code")).toHaveTextContent("200");
    expect(within(result).getByTestId("webhook-test-latency")).toHaveTextContent("87 ms");
    expect(within(result).getByTestId("webhook-test-snippet")).toHaveTextContent('{"received":true}');
    expect(calls).toBe(1);
  });

  it("test: a failing receiver shows the status code, the mapped reason and the snippet as PLAIN text (markup is not rendered)", async () => {
    const user = userEvent.setup();
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Send a test to Slack relay" }));
    const dialog = await screen.findByTestId("webhook-test-dialog");
    expect(dialog).toHaveTextContent("This webhook is switched off. You can still test it.");
    await user.click(within(dialog).getByRole("button", { name: "Send test" }));
    const result = await within(dialog).findByTestId("webhook-test-result");
    expect(result).toHaveAttribute("data-ok", "false");
    expect(result).toHaveTextContent("The receiver answered with an error.");
    expect(within(result).getByTestId("webhook-test-status-code")).toHaveTextContent("500");
    const snippet = within(result).getByTestId("webhook-test-snippet");
    expect(snippet.textContent).toBe("internal error <b>not bold</b>");
    expect(snippet.querySelector("b")).toBeNull();
  });

  it.each([
    ["slow.example.org", "The receiver did not answer in time."],
    ["private.example.org", "The address is not allowed (private or internal network)."],
  ])("test: the error class of %s reads '%s'", async (host, message) => {
    const user = userEvent.setup();
    hooks().rows.find((r) => r.id === 1)!.url = `https://${host}/x`;
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Send a test to CRM sync" }));
    const dialog = await screen.findByTestId("webhook-test-dialog");
    await user.click(within(dialog).getByRole("button", { name: "Send test" }));
    expect(await within(dialog).findByTestId("webhook-test-result")).toHaveTextContent(message);
  });

  it("test: 429 says to wait (with Retry-After seconds) and 503 for the missing key says webhooks are not configured", async () => {
    const user = userEvent.setup();
    server.use(http.post(`${API}/webhooks/:id/test`, () => HttpResponse.json({ success: false, code: "RATE_LIMITED", message: "x" }, { status: 429, headers: { "Retry-After": "30" } }), { once: true }));
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Send a test to CRM sync" }));
    const dialog = await screen.findByTestId("webhook-test-dialog");
    await user.click(within(dialog).getByRole("button", { name: "Send test" }));
    expect(await within(dialog).findByTestId("webhook-test-failure")).toHaveTextContent("Too many tests. Try again in 30 seconds.");
    hooks().unconfigured = true;
    await user.click(within(dialog).getByRole("button", { name: "Send again" }));
    await waitFor(() => expect(within(dialog).getByTestId("webhook-test-failure")).toHaveAttribute("data-kind", "not_configured"));
    expect(within(dialog).getByTestId("webhook-test-failure")).toHaveTextContent("Webhooks are not configured on the server");
  });

  it("deliveries: newest first with event, status, attempt n / max, next try, code, problem and ms; a row opens to the receiver's answer as plain text", async () => {
    const user = userEvent.setup();
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Deliveries of CRM sync" }));
    const sheet = await screen.findByTestId("webhook-deliveries");
    await within(sheet).findAllByTestId("webhook-delivery-row");
    expect(within(sheet).getAllByTestId("webhook-delivery-row")).toHaveLength(20);
    const failed = within(sheet).getAllByTestId("webhook-delivery-row").find((r) => r.getAttribute("data-status") === "failed")!;
    expect(failed).toHaveTextContent("Failed, will retry");
    expect(failed).toHaveTextContent("2 / 8");
    expect(failed).toHaveTextContent("503");
    expect(failed).toHaveTextContent("The receiver answered with an error.");
    await user.click(within(failed).getByRole("button", { name: /^Show details of delivery/ }));
    const body = await within(sheet).findByTestId("webhook-delivery-body");
    expect(body.textContent).toBe("<img src=x onerror=alert(1)> Service Unavailable");
    expect(body.querySelector("img")).toBeNull();
    expect(sheet.querySelector("img")).toBeNull();
  });

  it("deliveries: the status and event filters are sent as a comma list / a value, and page 2 is reachable", async () => {
    const user = userEvent.setup();
    const urls: string[] = [];
    server.use(http.get(`${API}/webhooks/:id/deliveries`, ({ request }) => { urls.push(new URL(request.url).search); return undefined; }));
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Deliveries of CRM sync" }));
    const sheet = await screen.findByTestId("webhook-deliveries");
    await within(sheet).findAllByTestId("webhook-delivery-row");
    await user.click(within(within(sheet).getByRole("navigation", { name: "pagination" })).getByText("2"));
    await waitFor(() => expect(within(sheet).getAllByTestId("webhook-delivery-row")).toHaveLength(5));
    expect(urls.at(-1)).toContain("page=2");
    await user.click(within(sheet).getByRole("button", { name: /Status/ }));
    await user.click(await screen.findByRole("option", { name: /Failed, will retry/ }));
    await user.click(await screen.findByRole("option", { name: /Gave up/ }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(urls.at(-1)).toContain("status=failed,dead"));
    expect(urls.at(-1)).toContain("page=1");
    await waitFor(() => expect(within(sheet).getAllByTestId("webhook-delivery-row")).toHaveLength(2));
  });

  it("deliveries: Retry shows only on failed and dead rows, queues the delivery and refreshes", async () => {
    const user = userEvent.setup();
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Deliveries of CRM sync" }));
    const sheet = await screen.findByTestId("webhook-deliveries");
    await within(sheet).findAllByTestId("webhook-delivery-row");
    const retryable = within(sheet).getAllByTestId("webhook-delivery-row").filter((r) => within(r).queryByRole("button", { name: /^Retry delivery/ }));
    expect(retryable.map((r) => r.getAttribute("data-status")).sort()).toEqual(["failed"]);
    // a test message can never be retried: no button even when it is dead
    const test = hooks().deliveries.find((d) => d.webhook_id === 1 && d.event_type === "webhook.test")!;
    test.status = "dead";
    await user.click(within(sheet).getByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(within(sheet).getAllByTestId("webhook-delivery-row").some((r) => r.getAttribute("data-status") === "dead")).toBe(true));
    expect(within(sheet).getAllByTestId("webhook-delivery-row").filter((r) => r.getAttribute("data-status") === "dead" && within(r).queryByRole("button", { name: /^Retry delivery/ }))).toHaveLength(0);
    test.status = "succeeded";
    await user.click(within(retryable[0]).getByRole("button", { name: /^Retry delivery/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Queued to be sent again."));
    expect(hooks().deliveries.filter((d) => d.webhook_id === 1 && d.status === "failed")).toHaveLength(0);
  });

  it.each([
    ["pending", "It is already waiting to be sent."],
    ["delivering", "It is being sent right now."],
    ["succeeded", "It was already delivered."],
    ["test_delivery", "A test message cannot be retried. Send a new test."],
    ["webhook_inactive", "The webhook is switched off. Turn it on first."],
  ])("deliveries: a retry refused with INVALID_STATE %s says '%s'", async (reason, message) => {
    const user = userEvent.setup();
    server.use(http.post(`${API}/webhook-deliveries/:id/retry`, () => HttpResponse.json({ success: false, code: "INVALID_STATE", message: "raw server text", details: { reason } }, { status: 409 })));
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Deliveries of CRM sync" }));
    const sheet = await screen.findByTestId("webhook-deliveries");
    await within(sheet).findAllByTestId("webhook-delivery-row");
    await user.click(within(sheet).getAllByRole("button", { name: /^Retry delivery/ })[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
  });

  it("deliveries: a reader sees the rows but no Retry button", async () => {
    const user = userEvent.setup();
    me.current = { id: 6, roleID: 2, permissions: grants({ "ops.webhooks": ["read"] }) };
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Deliveries of CRM sync" }));
    const sheet = await screen.findByTestId("webhook-deliveries");
    await within(sheet).findAllByTestId("webhook-delivery-row");
    expect(within(sheet).queryByRole("button", { name: /^Retry delivery/ })).toBeNull();
  });

  it("deliveries: an empty webhook says nothing has been sent", async () => {
    const user = userEvent.setup();
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Deliveries of Backup mirror" }));
    expect(await screen.findByText("Nothing has been sent yet.")).toBeInTheDocument();
  });

  it("History tab: the audit trail of ops.webhook with labelled actions; the system's switch-off is attributed to the system", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Edit CRM sync" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("tab", { name: "History" }));
    const list = await within(dialog).findByTestId("webhook-activity");
    for (const label of ["Created", "Changed", "Test sent", "Secret rotated"]) expect(within(list).getByText(label)).toBeInTheDocument();
    unmount();
    renderApp(<WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: "Edit Slack relay" }));
    dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("tab", { name: "History" }));
    const sys = await within(dialog).findByTestId("webhook-activity");
    expect(sys).toHaveTextContent("Switched off by the system");
    expect(sys).toHaveTextContent("System");
  });

  it("renders every server string as plain text (a hostile name and address are shown, not run)", async () => {
    hooks().rows[0].name = '<img src=x onerror="alert(1)">';
    hooks().rows[0].url = "https://hooks.example.com/<script>alert(1)</script>";
    renderApp(<WebhooksPage />);
    await screen.findByText('<img src=x onerror="alert(1)">');
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });
});
