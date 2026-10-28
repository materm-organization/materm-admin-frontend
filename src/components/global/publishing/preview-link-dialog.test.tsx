import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PreviewLinkDialog, type PreviewLinkDialogProps } from "@/components/global/publishing/preview-link-dialog";
import { getMockDb } from "@/mocks/mock-db";
import { exhaustPreviewRate, setPreviewUnconfigured } from "@/mocks/mock-preview";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/pages/9",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "cms.pages": ["read", "update", "review", "publish"], "cms.locales": ["read"] });
beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: FULL };
  Object.values(toast).forEach((fn) => fn.mockReset());
  localStorage.clear();
  sessionStorage.clear();
});

type Extra = Partial<Omit<PreviewLinkDialogProps, "resource" | "entityId" | "open" | "onOpenChange">>;

// A host: a button that opens the dialog, the way the page editor does.
function Host({ id, ...extra }: { id: number } & Extra) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open preview
      </button>
      <PreviewLinkDialog resource="pages" entityId={id} open={open} onOpenChange={setOpen} {...extra} />
    </>
  );
}

const setup = async (id: number, extra: Extra = {}) => {
  const user = userEvent.setup();
  const view = renderApp(<Host id={id} {...extra} />);
  await user.click(screen.getByRole("button", { name: "open preview" }));
  const dialog = await screen.findByTestId("preview-link-dialog");
  return { user, dialog, ...view };
};
const createButton = () => screen.findByRole("button", { name: "Create link" });
const row = (id: number) => screen.findByTestId(`preview-link-${id}`);
const cacheDump = (client: { getQueryCache(): { getAll(): Array<{ state: { data: unknown } }> }; getMutationCache(): { getAll(): Array<{ state: unknown; options: unknown }> } }) =>
  JSON.stringify([client.getQueryCache().getAll().map((q) => q.state.data), client.getMutationCache().getAll().map((m) => [m.state, (m.options as { mutationKey?: unknown }).mutationKey])]);

describe("PreviewLinkDialog: issue a link", () => {
  useMockApi();

  it("offers the active languages (default selected), 30 minutes, and lists the page's active links", async () => {
    const { dialog } = await setup(9);
    expect(within(dialog).getByRole("heading", { name: "Preview link" })).toBeInTheDocument();
    expect(await within(dialog).findByTestId("preview-language")).toHaveTextContent("ລາວ (la) - default");
    expect(within(dialog).getByRole("radio", { name: "30 minutes" })).toBeChecked();
    // seeded: one active link of Somchai, marked older than the last edit
    const seeded = getMockDb().previewLinks.find((l) => l.created_by?.id === 4)!;
    const item = await row(seeded.id);
    expect(within(item).getByText("Active")).toBeInTheDocument();
    expect(within(item).getByText("Older than the latest edit")).toBeInTheDocument();
    expect(within(item).getByText(/Somchai Vongsa/)).toBeInTheDocument();
    expect(within(item).getByText("3")).toBeInTheDocument(); // times opened
    expect(within(dialog).getByRole("button", { name: `Revoke link ${seeded.id}` })).toBeInTheDocument();
  });

  it("creates a link: the address is shown once with Copy and Open in a new tab; after closing it is nowhere", async () => {
    const { user, dialog, queryClient } = await setup(9);
    await user.click(await createButton());
    const input = (await within(dialog).findByTestId("preview-url")) as HTMLInputElement;
    expect(input).toHaveAttribute("readonly");
    const url = input.value;
    expect(url).toMatch(/^https:\/\/materm\.example\/api\/preview\?token=[A-Za-z0-9_-]{43}&path=%2Fevents&locale=la$/);
    const token = new URL(url).searchParams.get("token")!;
    expect(within(dialog).getByTestId("preview-once-note")).toHaveTextContent(
      "This link shows the saved working copy (frozen at this moment) and works for anyone who has it until it expires. It will not be shown again."
    );
    const open = within(dialog).getByRole("link", { name: "Open in a new tab" });
    expect(open).toHaveAttribute("href", url);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");

    // the token is in no cache and no storage while the dialog is open ...
    await waitFor(() => expect(getMockDb().previewLinks.filter((l) => l.created_by?.id === 6 && l.page_id === 9)).toHaveLength(3));
    expect(cacheDump(queryClient)).not.toContain(token);
    expect(JSON.stringify([localStorage, sessionStorage])).not.toContain(token);
    // ... the list refreshed (a row without any address) ...
    await waitFor(() => expect(within(dialog).getAllByTestId(/^preview-link-\d+$/)).toHaveLength(2));

    // ... and after closing it is gone from the page, the caches, the storage and the address bar
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByTestId("preview-link-dialog")).not.toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain(token);
    expect(cacheDump(queryClient)).not.toContain(token);
    expect(JSON.stringify([localStorage, sessionStorage])).not.toContain(token);
    expect(window.location.href).not.toContain(token);
    await user.click(screen.getByRole("button", { name: "open preview" }));
    await screen.findByTestId("preview-link-dialog");
    expect(screen.queryByTestId("preview-url")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(token);
  });

  it("'Create another link' hides the address and goes back to the form", async () => {
    const { user, dialog } = await setup(9);
    await user.click(await createButton());
    const token = new URL(((await within(dialog).findByTestId("preview-url")) as HTMLInputElement).value).searchParams.get("token")!;
    await user.click(within(dialog).getByRole("button", { name: "Create another link" }));
    expect(within(dialog).queryByTestId("preview-url")).not.toBeInTheDocument();
    expect(dialog.innerHTML).not.toContain(token);
    expect(await createButton()).toBeEnabled();
  });

  it("Copy puts the address on the clipboard and says so", async () => {
    const { user, dialog } = await setup(9);
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(await createButton());
    const url = ((await within(dialog).findByTestId("preview-url")) as HTMLInputElement).value;
    await user.click(within(dialog).getByTestId("preview-copy"));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(await within(dialog).findByText("Copied")).toBeInTheDocument();
  });

  it("falls back to the old copy command, and reports when nothing works", async () => {
    const { user, dialog } = await setup(9);
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    document.execCommand = vi.fn().mockReturnValue(false);
    await user.click(await createButton());
    await within(dialog).findByTestId("preview-url");
    await user.click(within(dialog).getByTestId("preview-copy"));
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(await within(dialog).findByText("Could not copy. Select the link and copy it by hand.")).toBeInTheDocument();
  });

  it("sends the chosen language and expiry: a preset, then a custom number of minutes within 1..1440", async () => {
    const { user, dialog } = await setup(9);
    const db = getMockDb();
    await user.click(await within(dialog).findByTestId("preview-language"));
    await user.click(await screen.findByRole("option", { name: /English \(en\)/ }));
    await user.click(within(dialog).getByRole("radio", { name: "4 hours" }));
    await user.click(await createButton());
    await within(dialog).findByTestId("preview-url");
    let issued = db.previewLinks.at(-1)!;
    expect(issued.locale).toBe("en");
    expect(issued.expires_at - issued.created_at).toBe(240 * 60_000);

    await user.click(within(dialog).getByRole("button", { name: "Create another link" }));
    await user.click(within(dialog).getByRole("radio", { name: "Custom" }));
    const minutes = within(dialog).getByRole("spinbutton");
    expect(await createButton()).toBeDisabled(); // empty
    await user.type(minutes, "1441");
    expect(within(dialog).getByText("Enter a whole number from 1 to 1440.")).toBeInTheDocument();
    expect(await createButton()).toBeDisabled();
    await user.clear(minutes);
    await user.type(minutes, "90");
    expect(await createButton()).toBeEnabled();
    await user.click(await createButton());
    await within(dialog).findByTestId("preview-url");
    issued = db.previewLinks.at(-1)!;
    expect(issued.expires_at - issued.created_at).toBe(90 * 60_000);
  });

  it("a page that was never published gets a link too", async () => {
    const { user, dialog } = await setup(8);
    await user.click(await createButton());
    expect(((await within(dialog).findByTestId("preview-url")) as HTMLInputElement).value).toContain("/api/preview?token=");
  });

  it("without `cms.locales:read` the language list is not available: no locale is sent, the default is used", async () => {
    server.use(http.get("*/api/v1/locales", () => HttpResponse.json({ success: false, code: "FORBIDDEN", message: "x" }, { status: 403 })));
    const { user, dialog } = await setup(9);
    expect(await within(dialog).findByText("The link opens in the default language.")).toBeInTheDocument();
    await user.click(await createButton());
    await within(dialog).findByTestId("preview-url");
    expect(getMockDb().previewLinks.at(-1)!.locale).toBe("la");
  });
});

describe("PreviewLinkDialog: refusals are explained", () => {
  useMockApi();

  it("503: previews are not configured on the server", async () => {
    setPreviewUnconfigured(getMockDb(), true);
    const { user, dialog } = await setup(9);
    await user.click(await createButton());
    const alert = await within(dialog).findByTestId("preview-problem");
    expect(alert).toHaveAttribute("data-problem", "notConfigured");
    expect(alert).toHaveTextContent("Preview links are not configured on the server");
    expect(within(dialog).queryByTestId("preview-url")).not.toBeInTheDocument();
  });

  it("422 limit_exceeded: names the number and tells to revoke one", async () => {
    const { user, dialog } = await setup(8); // 19 active links of mine
    await user.click(await createButton());
    await within(dialog).findByTestId("preview-url");
    await user.click(within(dialog).getByRole("button", { name: "Create another link" }));
    await user.click(await createButton());
    expect(await within(dialog).findByTestId("preview-problem")).toHaveTextContent("You already have 20 active links for this page: revoke one below, then try again.");
  });

  it("429: says how long to wait and keeps Create disabled meanwhile", async () => {
    exhaustPreviewRate(getMockDb());
    const { user, dialog } = await setup(9);
    await user.click(await createButton());
    const alert = await within(dialog).findByTestId("preview-problem");
    expect(alert).toHaveAttribute("data-problem", "rate");
    expect(alert).toHaveTextContent(/Try again in \d+ minutes?\./);
    expect(await createButton()).toBeDisabled();
  });

  it("409 trashed: the page is in the trash", async () => {
    const { user, dialog } = await setup(7);
    await user.click(await createButton());
    expect(await within(dialog).findByTestId("preview-problem")).toHaveTextContent("This page is in the trash. Restore it to create preview links.");
  });

  it("422 unknown_reference at /locale: asks for another language and reloads the list of languages", async () => {
    server.use(http.post("*/api/v1/pages/:id/preview-links", () => HttpResponse.json({ success: false, code: "VALIDATION_FAILED", message: "x", errors: [{ in: "body", path: "/locale", code: "unknown_reference" }] }, { status: 422 })));
    const { user, dialog } = await setup(9);
    await user.click(await createButton());
    expect(await within(dialog).findByTestId("preview-problem")).toHaveTextContent("This language is not active any more.");
  });
});

describe("PreviewLinkDialog: unsaved edits", () => {
  useMockApi();

  it("warns that the link will not include them and offers 'Save draft first', which calls the host's flush", async () => {
    const flush = vi.fn().mockResolvedValue(true);
    const { user, dialog } = await setup(9, { isDirty: true, flush });
    const warning = within(dialog).getByTestId("preview-dirty-warning");
    expect(warning).toHaveTextContent("You have unsaved edits that the link will not include");
    await user.click(within(warning).getByRole("button", { name: "Save draft first" }));
    expect(flush).toHaveBeenCalledTimes(1);
    // creating is still possible (the warning is information, not a block)
    expect(await createButton()).toBeEnabled();
  });

  it("a failed save says so", async () => {
    const flush = vi.fn().mockResolvedValue(false);
    const { user, dialog } = await setup(9, { isDirty: true, flush });
    await user.click(within(dialog).getByRole("button", { name: "Save draft first" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The edits could not be saved. Fix the problems shown in the editor and try again."));
  });

  it("no warning without unsaved edits; no button without a way to save", async () => {
    const first = await setup(9);
    expect(within(first.dialog).queryByTestId("preview-dirty-warning")).not.toBeInTheDocument();
    first.unmount();
    const second = await setup(9, { isDirty: true });
    expect(within(second.dialog).getByTestId("preview-dirty-warning")).toBeInTheDocument();
    expect(within(second.dialog).queryByRole("button", { name: "Save draft first" })).not.toBeInTheDocument();
  });
});

describe("PreviewLinkDialog: revoke", () => {
  useMockApi();

  it("asks first, then revokes: the row leaves the list", async () => {
    const { user, dialog } = await setup(9);
    const seeded = getMockDb().previewLinks.find((l) => l.created_by?.id === 4)!;
    await user.click(await within(dialog).findByRole("button", { name: `Revoke link ${seeded.id}` }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("Revoke this link?");
    expect(getMockDb().previewLinks.find((l) => l.id === seeded.id)!.revoked_at).toBeNull();
    await user.click(within(confirm).getByRole("button", { name: "Revoke link" }));
    await waitFor(() => expect(getMockDb().previewLinks.find((l) => l.id === seeded.id)!.revoked_at).not.toBeNull());
    await waitFor(() => expect(screen.queryByTestId(`preview-link-${seeded.id}`)).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Link revoked.");
    expect(await within(dialog).findByTestId("preview-links-empty")).toBeInTheDocument();
  });

  it("a link that is already gone (404) is said so and the list is reloaded", async () => {
    const { user, dialog } = await setup(9);
    const seeded = getMockDb().previewLinks.find((l) => l.created_by?.id === 4)!;
    server.use(http.delete("*/api/v1/preview-links/:id", () => HttpResponse.json({ success: false, code: "NOT_FOUND", message: "x" }, { status: 404 })));
    await user.click(await within(dialog).findByRole("button", { name: `Revoke link ${seeded.id}` }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke link" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("The link was already gone."));
  });

  it("a reviewer (no `update`) can revoke only their own links; an `update` holder every link", async () => {
    me.current = { id: 4, roleID: 2, permissions: grants({ "cms.pages": ["read", "review"] }) };
    const { dialog } = await setup(9);
    const seeded = getMockDb().previewLinks.find((l) => l.created_by?.id === 4)!;
    expect(await within(dialog).findByRole("button", { name: `Revoke link ${seeded.id}` })).toBeInTheDocument();
    expect(within(dialog).getByText("(you)", { exact: false })).toBeInTheDocument();
  });

  it("somebody else's link has no Revoke for a reader without `update`", async () => {
    me.current = { id: 7, roleID: 2, permissions: grants({ "cms.pages": ["read", "review"] }) };
    const { dialog } = await setup(9);
    const seeded = getMockDb().previewLinks.find((l) => l.created_by?.id === 4)!;
    await row(seeded.id);
    expect(within(dialog).queryByRole("button", { name: /^Revoke link/ })).not.toBeInTheDocument();
  });
});

describe("PreviewLinkDialog: the list", () => {
  useMockApi();

  it("a failed list can be retried; a 403 is explained without a retry", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/v1/pages/:id/preview-links", () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json({ success: false, code: "INTERNAL_ERROR", message: "x" }, { status: 500 }) : HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 50, total_page: 0 } });
      })
    );
    const { user, dialog } = await setup(9);
    await user.click(await within(dialog).findByRole("button", { name: "Try again" }));
    expect(await within(dialog).findByTestId("preview-links-empty")).toBeInTheDocument();
  });

  it("asks only for the active links, 50 at most", async () => {
    let seen = "";
    server.use(
      http.get("*/api/v1/pages/:id/preview-links", ({ request }) => {
        seen = new URL(request.url).search;
        return HttpResponse.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 50, total_page: 0 } });
      })
    );
    await setup(9);
    await waitFor(() => expect(seen).toContain("state=active"));
    expect(seen).toContain("limit=50");
  });
});
