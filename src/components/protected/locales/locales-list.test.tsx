import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalesList } from "@/components/protected/locales/locales-list";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "http://localhost:3000/api/v1";

const me = vi.hoisted(() => ({ current: { id: 1, roleID: 1, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/locales" }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const loc = (code: string, over: Record<string, unknown> = {}) => ({
  code, name: code === "la" ? "Lao" : code === "en" ? "English" : "Thai", native_name: code, short_label: code.toUpperCase(), flag: null,
  text_direction: "ltr", is_default: false, is_active: true, fallback_code: null, search_config: "simple",
  date_formats: { short: "{month}. {day}.{year}", months: MONTHS }, sort_order: 10, created_at: "", updated_at: `t-${code}`, ...over,
});
// la (default) <- en <- th
const LOCALES = [loc("la", { is_default: true, sort_order: 1 }), loc("en", { fallback_code: "la", sort_order: 2 }), loc("th", { fallback_code: "en", sort_order: 3, is_active: false })];

beforeEach(() => {
  me.current = { id: 1, roleID: 1, permissions: grants({ "cms.locales": ["read", "update"] }) };
  toasts.success.mockReset();
  toasts.error.mockReset();
  server.use(http.get(`${API}/locales`, () => HttpResponse.json({ success: true, data: LOCALES })));
});

describe("LocalesList (SCR-12)", () => {
  it("lists every language with the default marked, its date example and a locked switch", async () => {
    renderApp(<LocalesList />);
    expect((await screen.findAllByText("Sep. 05.2026")).length).toBe(3);
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Lao is active" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "English is active" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "Thai is active" })).not.toBeChecked();
  });

  it("switching a language on PATCHes only is_active", async () => {
    const u = userEvent.setup();
    let body: unknown;
    server.use(http.patch(`${API}/locales/th`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ success: true, data: loc("th") }); }));
    renderApp(<LocalesList />);
    await u.click(await screen.findByRole("switch", { name: "Thai is active" }));
    await waitFor(() => expect(body).toEqual({ is_active: true }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Thai is now active"));
  });

  it("switching off a language that others fall back to asks first and names them", async () => {
    const u = userEvent.setup();
    let called = 0;
    server.use(http.patch(`${API}/locales/en`, () => { called += 1; return HttpResponse.json({ success: true, data: loc("en", { is_active: false }) }); }));
    renderApp(<LocalesList />);
    await u.click(await screen.findByRole("switch", { name: "English is active" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/Thai/)).toBeInTheDocument();
    expect(called).toBe(0);
    await u.click(within(confirm).getByRole("button", { name: "Switch off" }));
    await waitFor(() => expect(called).toBe(1));
  });

  it("the edit sheet sends only the changed fields; the fallback picker offers only valid chains", async () => {
    const u = userEvent.setup();
    let body: unknown;
    server.use(http.patch(`${API}/locales/en`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ success: true, data: loc("en") }); }));
    renderApp(<LocalesList />);
    await u.click(await screen.findByRole("button", { name: "Edit English" }));
    const sheet = await screen.findByRole("dialog");
    // code / direction are read-only facts
    expect(within(sheet).getByText("ltr")).toBeInTheDocument();
    const nativeName = within(sheet).getByLabelText("Native name");
    await u.clear(nativeName);
    await u.type(nativeName, "English (EN)");
    // fallback of English: only Lao (Thai would loop back to English)
    await u.click(within(sheet).getByRole("combobox", { name: "Fallback language" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toContain("Lao (la)");
    expect(options).not.toContain("Thai (th)");
    expect(options).not.toContain("English (en)");
    await u.keyboard("{Escape}");
    await u.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body).toEqual({ native_name: "English (EN)" }));
  });

  it("the date template shows a live example and refuses an unknown placeholder", async () => {
    const u = userEvent.setup();
    renderApp(<LocalesList />);
    await u.click(await screen.findByRole("button", { name: "Edit English" }));
    const sheet = await screen.findByRole("dialog");
    const short = within(sheet).getByLabelText("Short date template");
    expect(within(sheet).getByTestId("short-example")).toHaveTextContent("Sep. 05.2026");
    await u.clear(short);
    await u.type(short, "{{day}/{{month}/{{year}");
    expect(within(sheet).getByTestId("short-example")).toHaveTextContent("05/Sep/2026");
    await u.clear(short);
    await u.type(short, "{{weekday}");
    await u.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByText(/nothing else in braces/)).toBeInTheDocument();
  });

  it("the default language has no fallback picker value and cannot be switched off", async () => {
    const u = userEvent.setup();
    renderApp(<LocalesList />);
    await u.click(await screen.findByRole("button", { name: "Edit Lao" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("combobox", { name: "Fallback language" })).toBeDisabled();
    expect(within(sheet).getByText("The default language has no fallback.")).toBeInTheDocument();
  });

  it("a server 422 fallback_cycle lands on the fallback field", async () => {
    const u = userEvent.setup();
    server.use(
      http.patch(`${API}/locales/th`, () =>
        HttpResponse.json({ success: false, code: "VALIDATION_FAILED", errors: [{ in: "body", path: "/fallback_code", code: "fallback_cycle" }] }, { status: 422 })
      )
    );
    renderApp(<LocalesList />);
    await u.click(await screen.findByRole("button", { name: "Edit Thai" }));
    const sheet = await screen.findByRole("dialog");
    await u.click(within(sheet).getByRole("combobox", { name: "Fallback language" }));
    await u.click(await screen.findByRole("option", { name: "Lao (la)" }));
    await u.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByText("The fallback chain would loop.")).toBeInTheDocument();
  });

  it("without cms.locales:update everything is view-only", async () => {
    me.current = { id: 1, roleID: 1, permissions: grants({ "cms.locales": ["read"] }) };
    const u = userEvent.setup();
    renderApp(<LocalesList />);
    expect(await screen.findByRole("switch", { name: "English is active" })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "Edit English" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(sheet).getByLabelText("Native name")).toBeDisabled();
  });

  it("403 shows the no-permission state", async () => {
    server.use(http.get(`${API}/locales`, () => HttpResponse.json({ success: false, code: "FORBIDDEN" }, { status: 403 })));
    renderApp(<LocalesList />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });
});
