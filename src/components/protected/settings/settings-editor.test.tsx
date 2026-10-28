import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SeoPage } from "@/components/protected/seo/seo-page";
import { SettingsEditor } from "@/components/protected/settings/settings-editor";
import { getMockDb } from "@/mocks/mock-db";
import { getSettingsGroup } from "@/mocks/mock-settings";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/settings/brand",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "cms.settings": ["read", "update", "translate"], "cms.seo": ["read", "update", "translate"], "cms.locales": ["read"], "media.library": ["read"] });
beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: FULL };
  toast.success.mockReset();
  toast.error.mockReset();
});
const values = (group: string) => getSettingsGroup(getMockDb(), group).data.values;

describe("SettingsEditor (SCR-15)", () => {
  useMockApi();

  it("builds the form from the group's definitions and saves the whole group with If-Match; the new ETag is used by the next save", async () => {
    const user = userEvent.setup();
    const seen: Array<{ ifMatch: string | null; body: { values: Record<string, unknown>; change_note?: string } }> = [];
    server.use(
      http.put(`${API}/settings/contact`, async ({ request }) => {
        seen.push({ ifMatch: request.headers.get("If-Match"), body: (await request.clone().json()) as never });
        return undefined; // fall through to the model
      })
    );
    renderApp(<SettingsEditor group="contact" />);
    const phone = await screen.findByLabelText(/Phone \(international format\)/);
    expect(phone).toHaveValue("+8562000000000");
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(phone);
    await user.type(phone, "+8562099999999");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(seen[0].ifMatch).toBe('"0"');
    expect(Object.keys(seen[0].body.values)).toEqual(expect.arrayContaining(["address", "phone", "phone_display", "email", "hours", "map_url"]));
    expect(seen[0].body.values.phone).toBe("+8562099999999");
    expect(seen[0].body.values.map_url).toBeNull();
    expect(values("contact").phone).toBe("+8562099999999");
    // saved: nothing left to save; a second edit is sent with the ETag the first answer carried
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
    await user.clear(screen.getByLabelText("Phone as shown"));
    await user.type(screen.getByLabelText("Phone as shown"), "020 99 999 999");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1].ifMatch).toBe('"1"');
  });

  it("client checks block the request and show the server's wording at the field; a 422 from the server lands on its field too", async () => {
    const user = userEvent.setup();
    let puts = 0;
    server.use(
      http.put(`${API}/settings/contact`, () => {
        puts += 1;
        return undefined;
      })
    );
    renderApp(<SettingsEditor group="contact" />);
    const phone = await screen.findByLabelText(/Phone \(international format\)/);
    await user.clear(phone);
    await user.type(phone, "020123");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The value does not match the required pattern.")).toBeInTheDocument();
    expect(puts).toBe(0);
    expect(phone).toHaveAttribute("aria-invalid", "true");
    // typing in the field clears its message
    await user.type(phone, "4");
    expect(screen.queryByText("The value does not match the required pattern.")).not.toBeInTheDocument();
    // the server says no to something the client allows
    server.use(
      http.put(`${API}/settings/contact`, () =>
        HttpResponse.json({ success: false, code: "VALIDATION_FAILED", message: "bad", errors: [{ in: "body", path: "/values/email", code: "invalid_format" }] }, { status: 422 })
      )
    );
    await user.clear(phone);
    await user.type(phone, "+8562011122233");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The value has an invalid format.")).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("aria-invalid", "true");
  });

  it("edits a language at a time with the language switch; the field carries the per-language limit and a counter", async () => {
    const user = userEvent.setup();
    renderApp(<SettingsEditor group="brand" />);
    const statement = await screen.findByLabelText(/Brand statement/);
    expect(statement).toHaveValue((values("brand").statement as Record<string, string>).la);
    await user.click(screen.getByRole("radio", { name: /^English/ }));
    const en = screen.getByLabelText(/Brand statement/);
    await user.clear(en);
    await user.type(en, "Wild paths.");
    expect(screen.getByText(/11 \/ 300/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(values("brand").statement).toMatchObject({ en: "Wild paths." });
  });

  it("a settings image uses the MediaPicker; removing it saves null", async () => {
    const user = userEvent.setup();
    renderApp(<SettingsEditor group="brand" />);
    await screen.findByLabelText(/Brand name/);
    expect(screen.getByTestId("media-name-logo_media_id")).toHaveTextContent("materm-logo-white.svg");
    await user.click(screen.getByRole("button", { name: "Change image: Logo" }));
    const picker = await screen.findByRole("dialog");
    expect(within(picker).getByText(/Choose an image for "Logo"/)).toBeInTheDocument();
    await user.click(await within(picker).findByRole("button", { name: /materm-emblem\.svg/ }));
    await waitFor(() => expect(screen.getByTestId("media-name-logo_media_id")).toHaveTextContent("materm-emblem.svg"));
    await user.click(screen.getByRole("button", { name: "Remove: Emblem" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(values("brand")).toMatchObject({ logo_media_id: 24, emblem_media_id: null });
  });

  it("a stale ETag (someone else saved) opens the conflict dialog with my changes; reloading shows the other version", async () => {
    const user = userEvent.setup();
    renderApp(<SettingsEditor group="contact" />);
    const phone = await screen.findByLabelText(/Phone \(international format\)/);
    // someone else saves in the meantime
    const db = getMockDb();
    db.revisions["settings/contact"] = [{ ...db.revisions["settings/brand"][0], id: 7777, version: 1 }];
    db.settings.find((r) => r.group === "contact" && r.key === "hours")!.translations = { la: "Other", en: "Other" };
    await user.clear(phone);
    await user.type(phone, "+8562011122233");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: /Someone else changed this item/ });
    await user.click(within(dialog).getByRole("button", { name: /Keep my changes/ }));
    expect(within(dialog).getByText("+8562011122233")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Load the latest version/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Someone else/ })).not.toBeInTheDocument());
    expect(await screen.findByLabelText(/Phone \(international format\)/)).toHaveValue("+8562000000000");
  });

  it("with only `translate` the texts per language are editable and the other fields are locked; the PUT carries only the localized keys", async () => {
    const user = userEvent.setup();
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.settings": ["read", "translate"], "cms.locales": ["read"] }) };
    let body: { values: Record<string, unknown> } | null = null;
    server.use(
      http.put(`${API}/settings/brand`, async ({ request }) => {
        body = (await request.clone().json()) as never;
        return undefined;
      })
    );
    renderApp(<SettingsEditor group="brand" />);
    expect(await screen.findByText("Translation mode")).toBeInTheDocument();
    expect(screen.getByLabelText(/Brand name/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change image: Logo" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /^English/ }));
    const st = screen.getByLabelText(/Brand statement/);
    await user.clear(st);
    await user.type(st, "Translated.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(Object.keys(body!.values)).toEqual(["logo_alt", "emblem_alt", "statement"]);
  });

  it("read-only users get no mutation buttons and disabled fields; a user without read sees the no-permission state", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.settings": ["read"], "cms.locales": ["read"] }) };
    const { unmount } = renderApp(<SettingsEditor group="contact" />);
    expect(await screen.findByText("Read only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Phone \(international format\)/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
    unmount();
    server.use(http.get(`${API}/settings/contact`, () => HttpResponse.json({ success: false, code: "FORBIDDEN", message: "no" }, { status: 403 })));
    renderApp(<SettingsEditor group="contact" />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });

  it("the history sheet restores a version: If-Match = the group's revision number, then the form shows the restored text and the new ETag", async () => {
    const user = userEvent.setup();
    let ifMatch: string | null = null;
    server.use(
      http.post(`${API}/settings/brand/revisions/:revId/restore`, ({ request }) => {
        ifMatch = request.headers.get("If-Match");
        return undefined;
      })
    );
    renderApp(<SettingsEditor group="brand" />);
    await screen.findByLabelText(/Brand name/);
    await user.click(screen.getByRole("button", { name: "History" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(await within(sheet).findByRole("button", { name: "Restore version 1" }));
    const confirm = await screen.findByRole("dialog", { name: "Restore version 1?" });
    await user.click(within(confirm).getByRole("button", { name: "Restore version 1" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Version restored. It is live on the website."));
    expect(ifMatch).toBe('"2"');
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("media-name-logo_media_id")).toHaveTextContent("No image chosen");
    expect((values("brand").statement as Record<string, string>).en).toBe("Wild paths.");
  });

  it("a stale restore (the group moved on) shows the conflict dialog", async () => {
    const user = userEvent.setup();
    renderApp(<SettingsEditor group="brand" />);
    await screen.findByLabelText(/Brand name/);
    await user.click(screen.getByRole("button", { name: "History" }));
    const sheet = await screen.findByRole("dialog");
    getMockDb().revisions["settings/brand"].push({ ...getMockDb().revisions["settings/brand"][0], id: 8888, version: 3 });
    await user.click(await within(sheet).findByRole("button", { name: "Restore version 1" }));
    const confirm = await screen.findByRole("dialog", { name: "Restore version 1?" });
    await user.click(within(confirm).getByRole("button", { name: "Restore version 1" }));
    expect(await screen.findByText("Someone else changed this item")).toBeInTheDocument();
  });
});

describe("SeoPage (SCR-16)", () => {
  useMockApi();

  it("edits the seo group with its own key, previews the title and the search snippet live, warns on a long description, shows the sitemap link", async () => {
    const user = userEvent.setup();
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.seo": ["read", "update"], "cms.settings": ["read"], "cms.locales": ["read"] }) };
    renderApp(<SeoPage />);
    const tpl = await screen.findByLabelText(/Title template/);
    expect(screen.getByTestId("title-preview")).toHaveTextContent("Our Path | Materm");
    await user.clear(tpl);
    await user.type(tpl, "Materm - %s");
    expect(screen.getByTestId("title-preview")).toHaveTextContent("Materm - Our Path");
    await user.clear(tpl);
    await user.type(tpl, "no placeholder");
    expect(screen.getByTestId("title-preview")).toHaveTextContent("The template must contain %s exactly once.");
    await user.clear(tpl);
    await user.type(tpl, "%s | Materm");
    const desc = screen.getByLabelText(/Default description/);
    await user.clear(desc);
    await user.click(desc);
    await user.paste("x".repeat(170));
    expect(screen.getByText(/170 characters: longer than the 160/)).toBeInTheDocument();
    expect(screen.getByTestId("serp-preview")).toHaveTextContent("…");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("settings-warnings")).toHaveTextContent("has 170 characters");
    expect(await screen.findByRole("link", { name: /materm\.example\/sitemap\.xml/ })).toHaveAttribute("href", "https://materm.example/sitemap.xml");
  });

  it("a user with only cms.settings (no cms.seo) cannot read the group", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.settings": ["read", "update"], "cms.locales": ["read"] }) };
    server.use(http.get(`${API}/settings/seo`, () => HttpResponse.json({ success: false, code: "FORBIDDEN", message: "no" }, { status: 403 })));
    renderApp(<SeoPage />);
    expect(await screen.findByText("No permission")).toBeInTheDocument();
  });
});
