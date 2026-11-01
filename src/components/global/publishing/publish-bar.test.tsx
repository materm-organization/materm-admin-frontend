import { useQueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PublishBar, type PublishBarProps } from "@/components/global/publishing/publish-bar";
import { usePage, writeThroughPage } from "@/hooks/use-pages";
import { getMockDb } from "@/mocks/mock-db";
import { getPage, patchPage, touchPageAsSomeoneElse } from "@/mocks/mock-pages";
import { getPost, patchPost } from "@/mocks/mock-posts";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/pages/9",
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const push = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast }));

const FULL = grants({ "cms.pages": ["read", "create", "update", "delete", "publish", "unpublish", "translate", "review"] });
beforeEach(() => {
  me.current = { id: 6, roleID: 2, permissions: FULL };
  Object.values(toast).forEach((fn) => fn.mockReset());
});

type Extra = Partial<Omit<PublishBarProps, "resource" | "entity" | "etag">>;

// A host the way an editor is one: it holds the page and its ETag in the React Query cache and puts every answer back.
function Host({ id, onResult, ...extra }: { id: number; onResult?: PublishBarProps["onResult"] } & Extra) {
  const query = usePage(id);
  const queryClient = useQueryClient();
  if (!query.data) return null;
  const page = query.data.data.data;
  return (
    <PublishBar
      resource="pages"
      entity={{ id: page.id, status: page.status, has_unpublished_changes: page.has_unpublished_changes, deleted_at: page.deleted_at, is_home: page.is_home, is_system: page.is_system }}
      etag={query.data.etag}
      onRefresh={() => query.refetch()}
      onResult={(result) => {
        onResult?.(result);
        writeThroughPage(queryClient, id, { data: result.data, etag: result.etag });
      }}
      {...extra}
    />
  );
}

const renderBar = (id: number, extra: Extra & { onResult?: PublishBarProps["onResult"] } = {}) => renderApp(<Host id={id} {...extra} />);
const button = (name: string | RegExp) => screen.findByRole("button", { name });
const chip = async () => (await screen.findByTestId("status-badge")).textContent;
const root = (id: number) => getMockDb().pages.find((p) => p.id === id)!;

describe("PublishBar: the state chip and the buttons of each state (doc/07 2.5.7)", () => {
  useMockApi();

  it("a draft page: Draft only, Publish; no Unpublish, no Discard", async () => {
    renderBar(8);
    expect(await chip()).toBe("Draft only");
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument();
  });

  it("a published page without a draft: Published, Unpublish only (there is nothing to publish)", async () => {
    renderBar(10);
    expect(await chip()).toBe("Published");
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Publish/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument();
  });

  it("a published page with a pending draft: Publish changes, Discard changes and Unpublish", async () => {
    renderBar(9);
    expect(await chip()).toBe("Published, changes pending");
    expect(screen.getByRole("button", { name: "Publish changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeInTheDocument();
  });

  it("the home page can not be unpublished: no button", async () => {
    renderBar(1);
    expect(await chip()).toBe("Published");
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
  });

  it("an archived page can be published again; a page in the trash has no commands", async () => {
    root(8).status = "archived";
    const archived = renderBar(8);
    expect(await chip()).toBe("Archived");
    expect(await button("Publish")).toBeInTheDocument();
    archived.unmount();

    root(8).deleted_at = "2026-10-27T03:00:00.000000Z";
    renderBar(8);
    expect(await chip()).toBe("In the trash");
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("buttons the user may not use are not shown: read only sees the chip; publish without unpublish sees Publish only", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": ["read"] }) };
    const readOnly = renderBar(9);
    expect(await chip()).toBe("Published, changes pending");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    readOnly.unmount();

    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": ["read", "publish"] }) };
    renderBar(9);
    expect(await button("Publish changes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument(); // discard needs `update`
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument(); // preview needs read + update | review
  });
});

describe("PublishBar: save draft, unsaved edits and the preview link", () => {
  useMockApi();

  it("Publish is disabled while the host has unsaved edits (with the reason); Save draft is the host's callback", async () => {
    const user = userEvent.setup();
    const onSaveDraft = vi.fn();
    renderBar(8, { isDirty: true, onSaveDraft });
    const publish = await button("Publish");
    expect(publish).toBeDisabled();
    expect(screen.getByTestId("publish-dirty")).toHaveTextContent("You have unsaved changes.");
    await user.hover(publish.parentElement!);
    expect((await screen.findAllByText("Save your changes first. The draft is what gets published."))[0]).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("Save draft is only there when the host passes the callback, and is disabled with nothing to save", async () => {
    renderBar(8);
    await button("Publish");
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });

  it("flush runs before the dry run; when it says the edits were not saved nothing is sent", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    server.use(http.post(`${API}/pages/8/publish`, () => { calls.push("publish"); return undefined; }));
    const flush = vi.fn().mockResolvedValue(false);
    renderBar(8, { flush });
    await user.click(await button("Publish"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your changes could not be saved, so nothing was published."));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it("Preview is shown disabled with a tooltip when no handler is passed, and calls the handler when there is one", async () => {
    const user = userEvent.setup();
    const first = renderBar(8);
    const disabled = await button("Preview");
    expect(disabled).toBeDisabled();
    await user.hover(disabled.parentElement!);
    expect((await screen.findAllByText("Preview links are not available yet."))[0]).toBeInTheDocument();
    first.unmount();

    const onCreatePreviewLink = vi.fn();
    renderBar(8, { onCreatePreviewLink });
    const enabled = await button("Preview");
    expect(enabled).toBeEnabled();
    await user.click(enabled);
    expect(onCreatePreviewLink).toHaveBeenCalledTimes(1);
  });
});

describe("PublishBar: publish (dry run first, then the confirmation)", () => {
  useMockApi();

  it("a page that can not be published: the dry run opens the blockers (grouped), Go to field hands the pointer to the host, nothing is published", async () => {
    const user = userEvent.setup();
    const seen: Array<{ dry: string | null; ifMatch: string | null; key: string | null }> = [];
    server.use(
      http.post(`${API}/pages/6/publish`, ({ request }) => {
        seen.push({ dry: new URL(request.url).searchParams.get("dry_run"), ifMatch: request.headers.get("If-Match"), key: request.headers.get("Idempotency-Key") });
        return undefined;
      })
    );
    const onGoToField = vi.fn();
    const onResult = vi.fn();
    renderBar(6, { onGoToField, onResult });
    await user.click(await button("Publish"));
    const dialog = await screen.findByRole("dialog", { name: /cannot be published yet/ });
    expect(within(dialog).getByText(/4 things need to be fixed first/)).toBeInTheDocument();
    const items = within(dialog).getAllByTestId("publish-blocker");
    expect(items).toHaveLength(4);
    // grouped: the page itself, then section 1 (hero), then section 2 (photo story)
    expect(within(dialog).getByRole("region", { name: "Page details" })).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "Section 1: Hero (brand)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "Section 2: Photo story" })).toBeInTheDocument();
    expect(within(items[0]).getByText("SEO title")).toBeInTheDocument();
    expect(within(items[0]).getByText("Required in the default language (la).")).toBeInTheDocument();
    expect(within(items[1]).getByText("It points to something that no longer exists.")).toBeInTheDocument();
    expect(within(items[3]).getByText("It points to something that is not published.")).toBeInTheDocument();
    // the hidden section that would block is a warning, not a blocker
    expect(within(dialog).getAllByTestId("publish-warning")).toHaveLength(1);
    expect(seen).toEqual([{ dry: "true", ifMatch: '"1"', key: null }]);

    await user.click(within(dialog).getByRole("button", { name: "Go to field: Title" }));
    expect(onGoToField).toHaveBeenCalledTimes(1);
    expect(onGoToField.mock.calls[0][0]).toMatchObject({
      code: "empty_default_locale",
      locale: "la",
      sectionKey: "hero_brand",
      sectionIndex: 0,
    });
    expect(onGoToField.mock.calls[0][0].pointer).toMatch(/^\/sections\/[0-9a-f-]+\/props\/title\/la$/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
    expect(root(6).status).toBe("draft");
  });

  it("without onGoToField the blockers have no links", async () => {
    const user = userEvent.setup();
    renderBar(6);
    await user.click(await button("Publish"));
    const dialog = await screen.findByRole("dialog", { name: /cannot be published yet/ });
    expect(within(dialog).queryByRole("button", { name: /Go to field/ })).not.toBeInTheDocument();
  });

  it("a page that can be published: the dry run, a confirmation with the incomplete languages and the notes, then the real publish with an Idempotency-Key and the new ETag to the host", async () => {
    const user = userEvent.setup();
    const seen: Array<{ dry: string | null; ifMatch: string | null; key: string | null; body: unknown }> = [];
    server.use(
      http.post(`${API}/pages/8/publish`, async ({ request }) => {
        const text = await request.clone().text();
        seen.push({ dry: new URL(request.url).searchParams.get("dry_run"), ifMatch: request.headers.get("If-Match"), key: request.headers.get("Idempotency-Key"), body: text ? JSON.parse(text) : null });
        return undefined;
      })
    );
    const onResult = vi.fn();
    renderBar(8, { onResult });
    await user.click(await button("Publish"));
    const dialog = await screen.findByRole("dialog", { name: "Publish this page?" });
    expect(within(dialog).getByTestId("publish-language-line")).toHaveTextContent("en: 1 text is missing. The website shows the fallback language for them.");
    expect(within(dialog).getByTestId("publish-warning")).toHaveTextContent("A link points to a page that is not published");
    expect(seen).toHaveLength(1); // only the dry run so far
    await user.type(within(dialog).getByLabelText("Change note (optional)"), "first version");
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ dry: "true", key: null, body: null });
    expect(seen[1]).toMatchObject({ dry: null, ifMatch: '"1"', body: { change_note: "first version" } });
    expect(seen[1].key).toMatch(/^[0-9a-f-]{36}$/);
    const result = onResult.mock.calls[0][0];
    expect(result).toMatchObject({ action: "publish", etag: '"2"' });
    expect(result.data.aggregate).toMatchObject({ lock_version: 2, status: "published" });
    expect(toast.success).toHaveBeenCalledWith("Published.");
    // the host's cache has the new ETag and the chip follows without a refetch
    await waitFor(async () => expect(await chip()).toBe("Published"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a failed real publish keeps the confirmation open and the retry reuses the same Idempotency-Key", async () => {
    const user = userEvent.setup();
    const keys: Array<string | null> = [];
    let failOnce = true;
    server.use(
      http.post(`${API}/pages/8/publish`, ({ request }) => {
        if (new URL(request.url).searchParams.get("dry_run")) return undefined;
        keys.push(request.headers.get("Idempotency-Key"));
        if (failOnce) {
          failOnce = false;
          return HttpResponse.json({ success: false, code: "INTERNAL_ERROR", message: "boom" }, { status: 500 });
        }
        return undefined;
      })
    );
    const onResult = vi.fn();
    renderBar(8, { onResult });
    await user.click(await button("Publish"));
    const dialog = await screen.findByRole("dialog", { name: "Publish this page?" });
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(keys).toHaveLength(1));
    expect(screen.getByRole("dialog", { name: "Publish this page?" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("a published page with a pending draft: Publish changes puts the draft live", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderBar(9, { onResult });
    await user.click(await button("Publish changes"));
    const dialog = await screen.findByRole("dialog", { name: "Publish the changes to this page?" });
    await user.click(within(dialog).getByRole("button", { name: "Publish changes" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0].data).toMatchObject({ title: "Events and treks", has_unpublished_changes: false });
    await waitFor(async () => expect(await chip()).toBe("Published"));
    expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument();
  });

  it("the real publish answering 422 (it changed in between) opens the blockers", async () => {
    const user = userEvent.setup();
    renderBar(8);
    await user.click(await button("Publish"));
    const dialog = await screen.findByRole("dialog", { name: "Publish this page?" });
    // somebody hides the hero after the dry run
    const hero = root(8).live.sections[0];
    hero.is_visible = false;
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));
    const blockers = await screen.findByRole("dialog", { name: /cannot be published yet/ });
    expect(within(blockers).getByText("The page needs a visible hero section at the top.")).toBeInTheDocument();
    expect(within(blockers).getByRole("region", { name: "Page structure" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Publish this page?" })).not.toBeInTheDocument();
  });
});

describe("PublishBar: unpublish, discard and conflicts", () => {
  useMockApi();

  it("unpublish of a page others link to: asks, then lists who links, and repeats with confirm_references=true and a NEW Idempotency-Key", async () => {
    const user = userEvent.setup();
    const seen: Array<{ confirm: string | null; key: string | null }> = [];
    server.use(
      http.post(`${API}/pages/9/unpublish`, ({ request }) => {
        seen.push({ confirm: new URL(request.url).searchParams.get("confirm_references"), key: request.headers.get("Idempotency-Key") });
        return undefined;
      })
    );
    const onResult = vi.fn();
    renderBar(9, { onResult });
    await user.click(await button("Unpublish"));
    const ask = await screen.findByRole("alertdialog");
    expect(within(ask).getByText("Take this page off the website?")).toBeInTheDocument();
    expect(within(ask).getByText("Your unpublished changes are not lost: they are kept in the History tab.")).toBeInTheDocument();
    await user.click(within(ask).getByRole("button", { name: "Unpublish" }));

    const refs = await screen.findByTestId("referenced-dialog");
    expect(within(refs).getByText("A link in a section of \"Team\"")).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
    await user.click(within(refs).getByRole("button", { name: "Unpublish anyway" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(seen).toHaveLength(2);
    expect(seen[0].confirm).toBeNull(); // the first request NEVER carries confirm_references
    expect(seen[1].confirm).toBe("true");
    expect(seen[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[1].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[1].key).not.toBe(seen[0].key);
    expect(onResult.mock.calls[0][0]).toMatchObject({ action: "unpublish", etag: '"5"' });
    await waitFor(async () => expect(await chip()).toBe("Archived"));
  });

  it("unpublish with a pending draft: it succeeds and says the draft was kept in the History (a notice, not an error)", async () => {
    const user = userEvent.setup();
    root(10).live.sections[0].props.cta = undefined as never; // nothing links to page 9 any more
    delete (root(10).live.sections[0].props as Record<string, unknown>).cta;
    renderBar(9);
    await user.click(await button("Unpublish"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Unpublish" }));
    const notice = await screen.findByTestId("notice-draft_kept_as_history");
    expect(notice).toHaveTextContent("Your unpublished changes were kept");
    expect(notice).toHaveTextContent("They are in the History tab, so you can restore them later.");
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByTestId("referenced-dialog")).not.toBeInTheDocument();
    // the dismiss button closes it
    await user.click(within(notice).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("notice-draft_kept_as_history")).not.toBeInTheDocument();
    // and the draft really is a history row
    expect(getMockDb().revisions["pages/9"].find((r) => r.version === 5)).toMatchObject({ kind: "history", change_note: "unpublish" });
  });

  it("unpublish of a page nobody links to: no references step and no notice", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderBar(10, { onResult });
    await user.click(await button("Unpublish"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Unpublish" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("referenced-dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("publish-notices")).not.toBeInTheDocument();
    expect(onResult.mock.calls[0][0].warnings).toEqual([]);
  });

  it("discard draft: asks, discards, the host gets the new ETag, the draft stays in the History", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderBar(9, { onResult });
    await user.click(await button("Discard changes"));
    const ask = await screen.findByRole("alertdialog");
    expect(within(ask).getByText(/stays in the History tab, marked "discarded"/)).toBeInTheDocument();
    await user.click(within(ask).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0][0]).toMatchObject({ action: "discard", etag: '"5"' });
    await waitFor(async () => expect(await chip()).toBe("Published"));
    expect(getMockDb().revisions["pages/9"].find((r) => r.version === 5)).toMatchObject({ kind: "history", change_note: "discarded" });
  });

  it("409 CONFLICT_LOCK_VERSION opens the ConflictDialog (no force); loading the latest version calls onRefresh and the new ETag works", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderBar(10, { onResult });
    await user.click(await button("Unpublish"));
    const ask = await screen.findByRole("alertdialog");
    // somebody else saves the page while the dialog is open
    touchPageAsSomeoneElse(getMockDb(), 10);
    await user.click(within(ask).getByRole("button", { name: "Unpublish" }));
    const conflict = await screen.findByRole("dialog", { name: "Someone else changed this item" });
    expect(within(conflict).queryByRole("button", { name: /overwrite/i })).not.toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
    await user.click(within(conflict).getByRole("button", { name: "Load the latest version (discard my changes)" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // with the fresh ETag the same command works
    await user.click(await button("Unpublish"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Unpublish" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
  });

  it("an INVALID_STATE answer (the page was not in the state the bar showed) is explained and the host reloads", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    // the bar is told "published, pending changes" but the server has no draft
    renderApp(
      <PublishBar
        resource="pages"
        entity={{ id: 10, status: "published", has_unpublished_changes: true }}
        etag='"1"'
        onResult={vi.fn()}
        onRefresh={onRefresh}
      />
    );
    await user.click(await button("Publish changes"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("There is nothing to publish: no changes since the last publish."));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("without an ETag nothing can be sent: the commands are disabled", async () => {
    renderApp(<PublishBar resource="pages" entity={{ id: 8, status: "draft", has_unpublished_changes: false }} etag={undefined} onResult={vi.fn()} />);
    expect(await button("Publish")).toBeDisabled();
  });
});

// The posts entry (T1.5.5): `update_own` counts for the creator on save / discard / preview, never on publish / unpublish.
describe("PublishBar: a kind with update_own (posts, 05 13.3.2)", () => {
  useMockApi();
  const bar = (ownerId: number | null, status: "draft" | "published" = "published", pending = true) =>
    renderApp(
      <PublishBar
        resource="posts"
        entity={{ id: 3, status, has_unpublished_changes: pending, owner_id: ownerId }}
        etag='"1"'
        onSaveDraft={() => undefined}
        isDirty
        onCreatePreviewLink={() => undefined}
        onResult={() => undefined}
      />
    );

  it("the creator with update_own saves, discards and previews, but has no Publish / Unpublish", async () => {
    me.current = { id: 6, roleID: 3, permissions: grants({ "cms.blog": ["read", "create", "update_own", "delete_own", "translate"] }) };
    bar(6);
    expect(await button("Save draft")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
  });

  it("somebody else's post: a translator can save texts but there is no discard and no preview", async () => {
    me.current = { id: 6, roleID: 3, permissions: grants({ "cms.blog": ["read", "create", "update_own", "delete_own", "translate"] }) };
    bar(4);
    expect(await button("Save draft")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("an editor (update, publish, unpublish) has everything on any post; the buttons carry the post's wording", async () => {
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.blog": ["read", "update", "publish", "unpublish", "review", "translate"] }) };
    bar(4);
    expect(await button("Publish changes")).toBeDisabled(); // dirty
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
  });

  it("pages are unaffected by the owner: cms.pages has no update_own", async () => {
    me.current = { id: 6, roleID: 3, permissions: grants({ "cms.pages": ["read", "update_own"] }) };
    renderApp(<PublishBar resource="pages" entity={{ id: 8, status: "draft", has_unpublished_changes: false, owner_id: 6 }} etag='"1"' onSaveDraft={() => undefined} onResult={() => undefined} />);
    await screen.findByTestId("publish-bar");
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });
});

describe("PublishBar: the automatic redirects of a publish that moved an address (doc/05 14.12)", () => {
  useMockApi();
  const WITH_REDIRECTS = grants({
    "cms.pages": ["read", "create", "update", "delete", "publish", "unpublish", "translate", "review"],
    "cms.blog": ["read", "create", "update", "delete", "publish", "unpublish", "translate", "review"],
    "cms.redirects": ["read"],
  });
  beforeEach(() => {
    me.current = { id: 6, roleID: 2, permissions: WITH_REDIRECTS };
    push.mockReset();
  });

  const publishPageNow = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await button(/^Publish/));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^Publish/ }));
  };

  it("a page that moved: a short toast says the redirect was created, with a link to Redirects, and no warning notice", async () => {
    const user = userEvent.setup();
    const db = getMockDb();
    patchPage(db, "9", { path: "/happenings" }, getPage(db, "9").etag);
    renderBar(9);
    await publishPageNow(user);
    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    const [text, options] = toast.info.mock.calls[0];
    expect(text).toBe("A redirect from /events to /happenings was created automatically.");
    expect(options.action.label).toBe("Open Redirects");
    options.action.onClick();
    expect(push).toHaveBeenCalledWith("/admin/redirects");
    expect(db.redirects.some((r) => r.source_path === "/events" && r.target === "/happenings" && r.status_code === 301)).toBe(true);
    expect(screen.queryByTestId("notice-auto_redirect_skipped")).not.toBeInTheDocument();
  });

  it("a page whose old address is held by an editor's redirect: a clear warning with the reason (seed redirect /team), what to do and a link", async () => {
    const user = userEvent.setup();
    const db = getMockDb();
    // the seed already has an editor redirect /team -> /about
    patchPage(db, "10", { path: "/people" }, getPage(db, "10").etag);
    renderBar(10);
    await publishPageNow(user);
    const notice = await screen.findByTestId("notice-auto_redirect_skipped");
    expect(notice).toHaveTextContent("No automatic redirect was created for /team");
    expect(notice).toHaveTextContent("Old links go to /about. If they should go to /people, open Redirects and change it.");
    expect(within(notice).getByTestId("notice-open-redirects")).toHaveAttribute("href", "/admin/redirects");
    expect(toast.info).not.toHaveBeenCalled();
    expect(db.redirects.filter((r) => r.source_path === "/team" && !r.deleted_at)).toHaveLength(1);
  });

  it("an unknown skip reason still gets a plain generic text", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/pages/10/publish`, async ({ request }) => {
        if (new URL(request.url).searchParams.get("dry_run")) return undefined;
        return HttpResponse.json(
          { data: { aggregate: { entity_type: "cms.pages", id: 10, lock_version: 9, status: "published", has_unpublished_changes: false, updated_at: "2026-11-01T00:00:00Z" }, warnings: [{ path: "/path", code: "auto_redirect_skipped", params: { reason: "chain_too_long", hops: 5, max: 3, source_path: "/a", target: "/b", locale_code: null } }] } },
          { headers: { ETag: '"9"' } }
        );
      })
    );
    patchPage(getMockDb(), "10", { path: "/people" }, getPage(getMockDb(), "10").etag);
    renderBar(10);
    await publishPageNow(user);
    expect(await screen.findByTestId("notice-auto_redirect_skipped")).toHaveTextContent("Old links would need too many steps to reach the page.");
  });

  it("a post whose slug moved in one language: the toast names the /blog address and the language", async () => {
    const user = userEvent.setup();
    const db = getMockDb();
    const patched = patchPost(db, "2", { translations: { en: { slug: "dawn-paddle" } } }, getPost(db, "2").etag);
    renderApp(<PublishBar resource="posts" entity={{ id: 2, status: "published", has_unpublished_changes: true, owner_id: 6 }} etag={patched.etag} onResult={() => undefined} />);
    await publishPageNow(user);
    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    expect(toast.info.mock.calls[0][0]).toBe("A redirect from /blog/sunrise-paddle-on-the-mekong to /blog/dawn-paddle (en) was created automatically.");
    expect(db.redirects.some((r) => r.source_path === "/blog/sunrise-paddle-on-the-mekong" && r.locale_code === "en")).toBe(true);
  });

  it("without the right to read redirects the toast has no link and the notice has no link", async () => {
    const user = userEvent.setup();
    me.current = { id: 6, roleID: 2, permissions: FULL };
    const db = getMockDb();
    patchPage(db, "9", { path: "/happenings" }, getPage(db, "9").etag);
    renderBar(9);
    await publishPageNow(user);
    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    expect(toast.info.mock.calls[0][1]).toBeUndefined();
  });
});
