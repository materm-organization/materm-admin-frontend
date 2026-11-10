import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublishBar, type PublishBarProps } from "@/components/global/publishing/publish-bar";
import { usePage, writeThroughPage } from "@/hooks/use-pages";
import { usePost, writeThroughPost } from "@/hooks/use-posts";
import { getMockDb } from "@/mocks/mock-db";
import { getPage, listPageRevisions, schedulePage, submitPageForReview } from "@/mocks/mock-pages";
import { getPost } from "@/mocks/mock-posts";
import { failSchedule, makeScheduleOverdue } from "@/mocks/mock-schedule-helpers";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

// D1 (doc/05 12.10 - 12.11, doc/07 2.5.7): the review and schedule commands of the PublishBar, over the strict mock API.
const API = "*/api/v1";
const NOW = new Date("2026-11-10T03:00:00.000Z"); // 10:00 in Vientiane
const me = vi.hoisted(() => ({ current: { id: 6, roleID: 2, permissions: [] as PermissionGrant[] } }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/pages/8",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
// The calendar popover is covered by its own tests: here the field is a text box taking "yyyy-MM-dd HH:mm" in Asia/Vientiane, converted by the REAL lib/datetime.
vi.mock("@/components/global/date-time-field", async () => {
  const { isoToZonedParts, zonedPartsToIso } = await import("@/lib/datetime");
  return {
    DateTimeField: ({ value, onChange, id, "aria-label": label }: { value: string | null; onChange: (v: string | null) => void; id?: string; "aria-label"?: string }) => {
      const parts = value ? isoToZonedParts(value) : null;
      return (
        <input
          id={id}
          aria-label={label}
          data-testid="when"
          value={parts ? `${parts.date} ${parts.time}` : ""}
          onChange={(e) => {
            const [d, t] = e.target.value.split(" ");
            onChange(zonedPartsToIso(d, t ?? ""));
          }}
        />
      );
    },
  };
});

const PAGE_FULL = grants({ "cms.pages": ["read", "create", "update", "delete", "publish", "unpublish", "translate", "review", "schedule"] });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  me.current = { id: 6, roleID: 2, permissions: PAGE_FULL };
  Object.values(toast).forEach((fn) => fn.mockReset());
});
afterEach(() => vi.useRealTimers());

type Extra = Partial<Omit<PublishBarProps, "resource" | "entity" | "etag">>;

function PageHost({ id, onResult, ...extra }: { id: number; onResult?: PublishBarProps["onResult"] } & Extra) {
  const query = usePage(id);
  const queryClient = useQueryClient();
  if (!query.data) return null;
  const page = query.data.data.data;
  return (
    <PublishBar
      resource="pages"
      entity={{
        id: page.id,
        status: page.status,
        has_unpublished_changes: page.has_unpublished_changes,
        deleted_at: page.deleted_at,
        is_home: page.is_home,
        is_system: page.is_system,
        schedule: page.schedule,
        scheduled_at: page.scheduled_at,
        first_published_at: page.first_published_at,
      }}
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
function PostHost({ id }: { id: number }) {
  const query = usePost(id);
  const queryClient = useQueryClient();
  if (!query.data) return null;
  const post = query.data.data.data;
  return (
    <PublishBar
      resource="posts"
      entity={{ id: post.id, status: post.status, has_unpublished_changes: post.has_unpublished_changes, deleted_at: post.deleted_at, owner_id: post.created_by?.id ?? null, schedule: post.schedule, scheduled_at: post.scheduled_at, first_published_at: post.first_published_at }}
      etag={query.data.etag}
      onRefresh={() => query.refetch()}
      onResult={(result) => writeThroughPost(queryClient, id, { data: result.data, etag: result.etag })}
    />
  );
}

const renderPage = (id: number, extra: Extra & { onResult?: PublishBarProps["onResult"] } = {}) => renderApp(<PageHost id={id} {...extra} />);
const button = (name: string | RegExp) => screen.findByRole("button", { name });
// The Preview button has its own tests (publish-bar.test.tsx): left out of the lists.
const names = () => screen.queryAllByRole("button").map((b) => b.textContent?.trim()).filter((n) => n !== "Preview");
const chip = async () => (await screen.findByTestId("status-badge")).textContent;
const db = () => getMockDb();
const pageEtag = (id: number) => getPage(db(), String(id)).etag;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const user = () => userEvent.setup({ advanceTimers: () => undefined });
const setWhen = (value: string) => fireEvent.change(screen.getByTestId("when"), { target: { value } });

// ---------------------------------------------------------------------------------------------------------------------------------
describe("PublishBar D1: the buttons of each status (doc/07 2.5.7), a user who holds everything", () => {
  useMockApi();

  it("draft: Submit for review, Schedule…, Publish (and no reject / reschedule / cancel)", async () => {
    renderPage(8);
    expect(await chip()).toBe("Draft only");
    expect(names()).toEqual(["Submit for review", "Schedule…", "Publish"]);
  });

  it("in review: Reject…, Schedule…, Publish (no Submit)", async () => {
    submitPageForReview(db(), "8", undefined, pageEtag(8));
    renderPage(8);
    expect(await chip()).toBe("In review");
    expect(names()).toEqual(["Reject…", "Schedule…", "Publish"]);
  });

  it("scheduled: the time in Asia/Vientiane, Cancel schedule, Reschedule…, Unpublish, Publish now (no plain Schedule)", async () => {
    schedulePage(db(), "8", { scheduled_at: at(120) }, pageEtag(8));
    renderPage(8);
    expect(await chip()).toBe("Scheduled");
    const line = screen.getByTestId("schedule-status");
    expect(line).toHaveAttribute("data-health", "ok");
    expect(line).toHaveTextContent("Scheduled for Nov 10, 2026, 12:00 PM");
    expect(line).toHaveTextContent("Asia/Vientiane, UTC+7");
    expect(names()).toEqual(["Cancel schedule", "Reschedule…", "Unpublish", "Publish now"]);
  });

  it("published with a pending draft: Schedule changes…, Discard changes, Unpublish, Publish changes", async () => {
    renderPage(9);
    expect(await chip()).toBe("Published, changes pending");
    expect(names()).toEqual(["Discard changes", "Unpublish", "Schedule changes…", "Publish changes"]);
    expect(screen.queryByTestId("schedule-status")).not.toBeInTheDocument();
  });

  it("published with its pending draft booked (apply_revision): says when the changes go live, with Cancel schedule and Reschedule…", async () => {
    schedulePage(db(), "9", { scheduled_at: at(90) }, pageEtag(9));
    renderPage(9);
    expect(await chip()).toBe("Published, changes pending");
    expect(screen.getByTestId("schedule-status")).toHaveTextContent("Changes go live at Nov 10, 2026, 11:30 AM");
    expect(names()).toEqual(["Discard changes", "Cancel schedule", "Reschedule…", "Unpublish", "Publish changes"]);
  });

  it("archived: Schedule… and Publish; a published page without a draft or a page in the trash: no schedule button", async () => {
    db().pages.find((p) => p.id === 8)!.status = "archived";
    const archived = renderPage(8);
    expect(await chip()).toBe("Archived");
    expect(names()).toEqual(["Schedule…", "Publish"]);
    archived.unmount();
    const published = renderPage(10);
    expect(await chip()).toBe("Published");
    expect(names()).toEqual(["Unpublish"]);
    published.unmount();
    db().pages.find((p) => p.id === 7)!.deleted_at = "2026-10-27T03:00:00.000000Z";
    renderPage(7);
    expect(await chip()).toBe("In the trash");
    expect(names()).toEqual([]);
  });

  it("overdue (the time passed, the server has not fired yet): amber chip and line; failed (3 attempts): destructive chip, the reason, and the way out", async () => {
    schedulePage(db(), "8", { scheduled_at: at(120) }, pageEtag(8));
    makeScheduleOverdue(db(), "pages", 8);
    const first = renderPage(8);
    expect(await chip()).toBe("Scheduled, overdue");
    expect(screen.getByTestId("status-badge")).toHaveAttribute("data-state", "scheduled_overdue");
    expect(screen.getByTestId("schedule-status")).toHaveAttribute("data-health", "overdue");
    expect(screen.getByTestId("schedule-status")).toHaveTextContent(/overdue/);
    first.unmount();

    failSchedule(db(), "pages", 8, "media_alt_missing");
    renderPage(8);
    expect(await chip()).toBe("Scheduled, failed");
    const line = screen.getByTestId("schedule-status");
    expect(line).toHaveAttribute("data-health", "failed");
    expect(line).toHaveTextContent("failed after 3 attempts");
    expect(screen.getByTestId("schedule-last-error")).toHaveTextContent("Reason: media_alt_missing.");
    expect(line).toHaveTextContent("cancel the schedule, pick a new time, or publish now");
    // the way out is all there: unschedule, reschedule, publish now
    expect(names()).toEqual(["Cancel schedule", "Reschedule…", "Unpublish", "Publish now"]);
  });
});

describe("PublishBar D1: rights", () => {
  useMockApi();

  it("review needs `review` (Reject…) and `update` (Submit); schedule needs `schedule` AND `publish` (BR-11)", async () => {
    const cases: Array<[string[], string[]]> = [
      [["read", "update", "publish", "schedule"], ["Submit for review", "Schedule…", "Publish"]],
      [["read", "update", "publish"], ["Submit for review", "Publish"]], // publish without schedule
      [["read", "update", "schedule"], ["Submit for review"]], // schedule WITHOUT publish: nothing to schedule with
      [["read", "publish", "schedule"], ["Schedule…", "Publish"]], // no `update`: no Submit
      [["read"], []],
    ];
    for (const [actions, expected] of cases) {
      me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": actions }) };
      const view = renderPage(8);
      await chip();
      expect(names(), actions.join(",")).toEqual(expected);
      view.unmount();
    }
    submitPageForReview(db(), "8", undefined, pageEtag(8));
    for (const [actions, expected] of [
      [["read", "review"], ["Reject…"]],
      [["read", "update"], []],
      [["read", "review", "publish", "schedule"], ["Reject…", "Schedule…", "Publish"]],
    ] as Array<[string[], string[]]>) {
      me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": actions }) };
      const view = renderPage(8);
      await chip();
      expect(names(), actions.join(",")).toEqual(expected);
      view.unmount();
    }
  });

  it("a scheduled item for a user without schedule: the time is shown, Publish now / Unpublish stay by their own rights", async () => {
    schedulePage(db(), "8", { scheduled_at: at(120) }, pageEtag(8));
    me.current = { id: 6, roleID: 2, permissions: grants({ "cms.pages": ["read", "publish", "unpublish"] }) };
    renderPage(8);
    expect(await chip()).toBe("Scheduled");
    expect(screen.getByTestId("schedule-status")).toBeInTheDocument();
    expect(names()).toEqual(["Unpublish", "Publish now"]);
  });

  it("which kinds have a review / a schedule: pages and posts review; pages, posts, albums, entries schedule; FAQ groups, forms, shared sections neither", async () => {
    const all = (key: string) => grants({ [key]: ["read", "update", "publish", "unpublish", "schedule", "review"] });
    const expectBar = async (resource: PublishBarProps["resource"], key: string, id: number | string, expected: string[]) => {
      me.current = { id: 6, roleID: 2, permissions: all(key) };
      const view = renderApp(<PublishBar resource={resource} entity={{ id, status: "draft", has_unpublished_changes: false, owner_id: 6 }} etag='"1"' onResult={() => undefined} />);
      await chip();
      expect(names(), resource).toEqual(expected);
      view.unmount();
    };
    await expectBar("pages", "cms.pages", 8, ["Submit for review", "Schedule…", "Publish"]);
    await expectBar("posts", "cms.blog", 3, ["Submit for review", "Schedule…", "Publish"]);
    await expectBar("albums", "cms.galleries", 3, ["Schedule…", "Publish"]);
    await expectBar("collection-entries", "cms.collections", "events:1", ["Schedule…", "Publish"]);
    await expectBar("faq-groups", "cms.faq", 1, ["Publish"]);
    await expectBar("forms", "forms.manage", 1, ["Publish"]);
    await expectBar("shared-sections", "cms.sections", 1, ["Publish"]);
  });

  it("posts: an author submits her OWN draft (update_own) but never publishes or schedules; in review or scheduled (BR-10) she has no command at all", async () => {
    me.current = { id: 6, roleID: 3, permissions: grants({ "cms.blog": ["read", "create", "update_own", "delete_own", "translate"] }) };
    const own = (status: "draft" | "in_review" | "scheduled", owner: number) =>
      renderApp(<PublishBar resource="posts" entity={{ id: 3, status, has_unpublished_changes: false, owner_id: owner }} etag='"1"' onSaveDraft={() => undefined} onResult={() => undefined} />);
    let view = own("draft", 6);
    await chip();
    expect(names()).toEqual(["Save draft", "Submit for review"]);
    view.unmount();
    view = own("draft", 4); // somebody else's post: she may translate it (Save draft), nothing else
    await chip();
    expect(names()).toEqual(["Save draft"]);
    view.unmount();
    for (const status of ["in_review", "scheduled"] as const) {
      view = own(status, 6);
      await chip();
      expect(names(), status).toEqual([]);
      view.unmount();
    }
    // the editor (update) keeps working on a post in review
    me.current = { id: 9, roleID: 2, permissions: grants({ "cms.blog": ["read", "update", "review", "publish", "schedule"] }) };
    view = own("in_review", 6);
    await chip();
    expect(names()).toEqual(["Save draft", "Reject…", "Schedule…", "Publish"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("PublishBar D1: submit for review and reject", () => {
  useMockApi();

  it("Submit for review: a dialog with the optional note, If-Match + one Idempotency-Key, the new ETag goes to the host and the chip says In review", async () => {
    const u = user();
    const seen: Array<{ ifMatch: string | null; key: string | null; body: unknown }> = [];
    server.use(
      http.post(`${API}/pages/8/submit-review`, async ({ request }) => {
        seen.push({ ifMatch: request.headers.get("If-Match"), key: request.headers.get("Idempotency-Key"), body: await request.clone().json() });
        return undefined;
      })
    );
    const onResult = vi.fn();
    renderPage(8, { onResult });
    await u.click(await button("Submit for review"));
    const dialog = await screen.findByRole("dialog", { name: /Submit this page for review\?/ });
    await u.type(within(dialog).getByLabelText("Message to the reviewer (optional)"), "  please check the hero ");
    await u.click(within(dialog).getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(seen).toHaveLength(1);
    expect(seen[0].ifMatch).toBe('"1"');
    expect(seen[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0].body).toEqual({ note: "please check the hero" });
    expect(onResult.mock.calls[0][0]).toMatchObject({ action: "submit_review", etag: expect.stringMatching(/^"/), data: { status: "in_review" } });
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("In review"));
    expect(toast.success).toHaveBeenCalledWith("Submitted for review.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Submit without a note sends no body; it is disabled with a reason while the host has unsaved edits and calls flush first", async () => {
    const u = user();
    const bodies: string[] = [];
    server.use(
      http.post(`${API}/pages/8/submit-review`, async ({ request }) => {
        bodies.push(await request.clone().text());
        return undefined;
      })
    );
    const dirty = renderPage(8, { isDirty: true });
    const disabled = await button("Submit for review");
    expect(disabled).toBeDisabled();
    await u.hover(disabled.parentElement!);
    expect((await screen.findAllByText("Save your changes first. The saved draft is what goes to the reviewer."))[0]).toBeInTheDocument();
    dirty.unmount();

    const flush = vi.fn().mockResolvedValue(true);
    renderPage(8, { flush });
    await u.click(await button("Submit for review"));
    await u.click(await screen.findByRole("button", { name: "Submit for review", hidden: false }).then(() => within(screen.getByRole("dialog")).getByRole("button", { name: "Submit for review" })));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toBe("");
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("409 not_draft (somebody else already moved it): the INVALID_STATE text, the dialog closes and the host reloads", async () => {
    const u = user();
    const onRefresh = vi.fn();
    renderPage(8, { onRefresh });
    await u.click(await button("Submit for review"));
    submitPageForReview(db(), "8", undefined, pageEtag(8)); // elsewhere
    server.use(http.post(`${API}/pages/8/submit-review`, () => HttpResponse.json({ success: false, code: "INVALID_STATE", message: "x", details: { reason: "not_draft" } }, { status: 409 })));
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only a draft can be submitted for review. This page is not a draft any more."));
    expect(onRefresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Reject…: the comment is required (button disabled while empty), counted to 200 with a warning above it; the request carries it with If-Match and one Idempotency-Key; the History keeps it as the change note", async () => {
    const u = user();
    submitPageForReview(db(), "8", undefined, pageEtag(8));
    const seen: Array<{ ifMatch: string | null; key: string | null; body: unknown }> = [];
    server.use(
      http.post(`${API}/pages/8/reject`, async ({ request }) => {
        seen.push({ ifMatch: request.headers.get("If-Match"), key: request.headers.get("Idempotency-Key"), body: await request.clone().json() });
        return undefined;
      })
    );
    const onResult = vi.fn();
    const { queryClient } = renderPage(8, { onResult });
    await u.click(await button("Reject…"));
    const dialog = await screen.findByRole("dialog", { name: /Send this page back\?/ });
    const send = within(dialog).getByRole("button", { name: "Send back" });
    expect(send).toBeDisabled();
    expect(within(dialog).getByTestId("reject-counter")).toHaveTextContent("0 / 200");
    const box = within(dialog).getByLabelText("Reason (required)");
    fireEvent.change(box, { target: { value: "   " } });
    expect(send).toBeDisabled();
    fireEvent.change(box, { target: { value: "x".repeat(201) } });
    expect(within(dialog).getByTestId("reject-counter")).toHaveTextContent("201 / 200");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The reason is too long (at most 200 characters).");
    expect(send).toBeDisabled();
    fireEvent.change(box, { target: { value: "The hero needs an alt text." } });
    expect(within(dialog).getByTestId("reject-counter")).toHaveTextContent("27 / 200");
    expect(send).toBeEnabled();
    await u.click(send);
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([{ ifMatch: expect.stringMatching(/^"/), key: expect.stringMatching(/^[0-9a-f-]{36}$/), body: { comment: "The hero needs an alt text." } }]);
    expect(onResult.mock.calls[0][0]).toMatchObject({ action: "reject", data: { status: "draft", review_revision: { version: expect.any(Number) } } });
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("Draft only"));
    expect(toast.success).toHaveBeenCalledWith("Sent back with your comment.");
    const history = listPageRevisions(db(), "8", new URLSearchParams("kind=history")).data;
    expect(history[0]).toMatchObject({ change_note: "The hero needs an alt text." });
    // nothing of the comment is left in the mutation cache once the dialog is closed
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((m) => [m.state.variables, m.state.data]))).not.toContain("alt text");
  });

  it("a 422 from the server at /comment is shown in the dialog (it stays open, the key is reused for the retry); the text is gone after close and reopen", async () => {
    const u = user();
    submitPageForReview(db(), "8", undefined, pageEtag(8));
    const keys: Array<string | null> = [];
    server.use(
      http.post(`${API}/pages/8/reject`, ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        return HttpResponse.json({ success: false, code: "VALIDATION_FAILED", message: "x", errors: [{ in: "body", path: "/comment", code: "too_long", params: { max: 200 } }] }, { status: 422 });
      })
    );
    renderPage(8);
    await u.click(await button("Reject…"));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "too much" } });
    await u.click(within(dialog).getByRole("button", { name: "Send back" }));
    expect(await within(dialog).findByText("The reason is too long (at most 200 characters).")).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBe(keys[1]); // a retry of the same dialog is the same request
    await u.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await u.click(await button("Reject…"));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Reason (required)")).toHaveValue("");
    expect(within(dialog).queryByText(/too long/)).not.toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await u.click(await button("Reject…"));
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    // a new open is a new key
    await u.click(await button("Reject…"));
    fireEvent.change(within(await screen.findByRole("dialog")).getByLabelText("Reason (required)"), { target: { value: "again" } });
    await u.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("409 not_in_review on reject: the text, the dialog closes, the host reloads", async () => {
    const u = user();
    submitPageForReview(db(), "8", undefined, pageEtag(8));
    const onRefresh = vi.fn();
    renderPage(8, { onRefresh });
    await u.click(await button("Reject…"));
    server.use(http.post(`${API}/pages/8/reject`, () => HttpResponse.json({ success: false, code: "INVALID_STATE", message: "x", details: { reason: "not_in_review" } }, { status: 409 })));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "no" } });
    await u.click(within(dialog).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This page is not waiting for review any more."));
    expect(onRefresh).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("PublishBar D1: schedule, reschedule, schedule changes, cancel", () => {
  useMockApi();

  it("Schedule…: the dry run first (no Idempotency-Key), then the dialog; the picked Vientiane time goes out as an instant, with If-Match and one Idempotency-Key; the bar shows the time", async () => {
    const u = user();
    const calls: Array<{ method: string; dry: string | null; key: string | null; ifMatch: string | null; body?: unknown }> = [];
    server.use(
      http.post(`${API}/pages/8/publish`, ({ request }) => {
        calls.push({ method: "publish", dry: new URL(request.url).searchParams.get("dry_run"), key: request.headers.get("Idempotency-Key"), ifMatch: request.headers.get("If-Match") });
        return undefined;
      }),
      http.post(`${API}/pages/8/schedule`, async ({ request }) => {
        calls.push({ method: "schedule", dry: null, key: request.headers.get("Idempotency-Key"), ifMatch: request.headers.get("If-Match"), body: await request.clone().json() });
        return undefined;
      })
    );
    const onResult = vi.fn();
    renderPage(8, { onResult });
    await u.click(await button("Schedule…"));
    const dialog = await screen.findByRole("dialog", { name: /Schedule this page/ });
    expect(calls).toEqual([{ method: "publish", dry: "true", key: null, ifMatch: '"1"' }]);
    expect(within(dialog).getByTestId("schedule-range-hint")).toHaveTextContent("Pick a time between Nov 10, 2026, 10:01 AM and Nov 10, 2027, 10:00 AM (Asia/Vientiane, UTC+7).");
    const confirm = within(dialog).getByRole("button", { name: "Schedule" });
    expect(confirm).toBeDisabled(); // nothing picked
    setWhen("2026-12-01 09:30");
    await u.click(confirm);
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(calls[1]).toMatchObject({ method: "schedule", ifMatch: '"1"', key: expect.stringMatching(/^[0-9a-f-]{36}$/), body: { scheduled_at: "2026-12-01T02:30:00.000Z" } });
    expect(onResult.mock.calls[0][0]).toMatchObject({ action: "schedule", data: { status: "scheduled", schedule: { action: "publish", status: "pending" } } });
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("Scheduled"));
    expect(screen.getByTestId("schedule-status")).toHaveTextContent("Scheduled for Dec 1, 2026, 9:30 AM");
    expect(toast.success).toHaveBeenCalledWith("Scheduled.");
    expect(names()).toEqual(["Cancel schedule", "Reschedule…", "Unpublish", "Publish now"]);
  });

  it("the time is checked in the browser first: less than a minute ahead and more than a year ahead are explained, nothing is sent", async () => {
    const u = user();
    let posts = 0;
    server.use(http.post(`${API}/pages/8/schedule`, () => { posts += 1; return undefined; }));
    renderPage(8);
    await u.click(await button("Schedule…"));
    const dialog = await screen.findByRole("dialog");
    setWhen("2026-11-10 10:00"); // now, in Vientiane
    await u.click(within(dialog).getByRole("button", { name: "Schedule" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Pick a time at least 1 minute from now.");
    setWhen("2026-11-10 10:01"); // exactly now + 1 minute is the earliest the server takes
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    setWhen("2027-11-10 10:01");
    await u.click(within(dialog).getByRole("button", { name: "Schedule" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Pick a time within the next year.");
    expect(posts).toBe(0);
  });

  it("422 out_of_range from the server (the clock moved): the message uses params.min / max and the dialog stays open", async () => {
    const u = user();
    server.use(
      http.post(`${API}/pages/8/schedule`, () =>
        HttpResponse.json(
          { success: false, code: "VALIDATION_FAILED", message: "x", errors: [{ in: "body", path: "/scheduled_at", code: "out_of_range", params: { min: "2026-11-10T10:05:00+07:00", max: "2027-11-10T10:04:00+07:00" } }] },
          { status: 422 }
        )
      )
    );
    renderPage(8);
    await u.click(await button("Schedule…"));
    const dialog = await screen.findByRole("dialog");
    setWhen("2026-12-01 09:30");
    await u.click(within(dialog).getByRole("button", { name: "Schedule" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The time has to be between Nov 10, 2026, 10:05 AM and Nov 10, 2027, 10:04 AM.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("429 (60 per hour): the wait from Retry-After in the dialog; the dialog stays open", async () => {
    const u = user();
    server.use(http.post(`${API}/pages/8/schedule`, () => HttpResponse.json({ success: false, code: "RATE_LIMITED", message: "x" }, { status: 429, headers: { "Retry-After": "125" } })));
    renderPage(8);
    await u.click(await button("Schedule…"));
    const dialog = await screen.findByRole("dialog");
    setWhen("2026-12-01 09:30");
    await u.click(within(dialog).getByRole("button", { name: "Schedule" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Too many schedules. Try again in 3 minutes.");
    // editing the time clears the notice
    setWhen("2026-12-02 09:30");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blockers: the dry run of a page that cannot be published opens the blockers dialog, there is no schedule dialog and no schedule request", async () => {
    const u = user();
    let posts = 0;
    server.use(http.post(`${API}/pages/6/schedule`, () => { posts += 1; return undefined; }));
    renderPage(6);
    await u.click(await button("Schedule…"));
    expect(await screen.findByRole("dialog", { name: /cannot be published yet/ })).toBeInTheDocument();
    expect(screen.queryByTestId("schedule-dialog")).not.toBeInTheDocument();
    expect(posts).toBe(0);
  });

  it("422 PUBLISH_BLOCKED on the schedule itself (the server re-validates) still opens the blockers dialog", async () => {
    const u = user();
    server.use(
      http.post(`${API}/pages/8/schedule`, () =>
        HttpResponse.json({ success: false, code: "PUBLISH_BLOCKED", message: "x", errors: [{ in: "entity", path: "/translations/la/title", code: "empty_default_locale", params: { locale: "la" } }], details: { blocker_count: 1, warnings: [] } }, { status: 422 })
      )
    );
    renderPage(8);
    await u.click(await button("Schedule…"));
    const dialog = await screen.findByRole("dialog", { name: /Schedule this page/ });
    setWhen("2026-12-01 09:30");
    await u.click(within(dialog).getByRole("button", { name: "Schedule" }));
    expect(await screen.findByRole("dialog", { name: /cannot be published yet/ })).toBeInTheDocument();
    expect(screen.queryByTestId("schedule-dialog")).not.toBeInTheDocument();
  });

  it("409 CONFLICT_LOCK_VERSION opens the conflict dialog; 409 nothing_to_publish explains and reloads", async () => {
    const u = user();
    const onRefresh = vi.fn();
    renderPage(8, { onRefresh });
    await u.click(await button("Schedule…"));
    server.use(http.post(`${API}/pages/8/schedule`, () => HttpResponse.json({ success: false, code: "CONFLICT_LOCK_VERSION", message: "x" }, { status: 409 })));
    let dialog = await screen.findByRole("dialog");
    setWhen("2026-12-01 09:30");
    await u.click(within(dialog).getByRole("button", { name: "Schedule" }));
    const conflict = await screen.findByRole("dialog", { name: "Someone else changed this item" });
    expect(screen.queryByTestId("schedule-dialog")).not.toBeInTheDocument();
    await u.click(within(conflict).getByRole("button", { name: "Load the latest version (discard my changes)" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());

    onRefresh.mockClear();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await u.click(await button("Schedule…"));
    server.use(http.post(`${API}/pages/8/schedule`, () => HttpResponse.json({ success: false, code: "INVALID_STATE", message: "x", details: { reason: "nothing_to_publish" } }, { status: 409 })));
    dialog = await screen.findByRole("dialog");
    setWhen("2026-12-01 09:30");
    await u.click(within(dialog).getByRole("button", { name: "Schedule" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("There is nothing to publish: no changes since the last publish."));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("Schedule changes… on a published page with a draft: dialog titled for the changes, apply_revision comes back, the page stays Published and the line says when", async () => {
    const u = user();
    renderPage(9);
    await u.click(await button("Schedule changes…"));
    const dialog = await screen.findByRole("dialog", { name: /Schedule the changes to this page/ });
    setWhen("2026-12-01 09:30");
    await u.click(within(dialog).getByRole("button", { name: "Schedule changes" }));
    await waitFor(() => expect(screen.getByTestId("schedule-status")).toHaveTextContent("Changes go live at Dec 1, 2026, 9:30 AM"));
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Published, changes pending");
    expect(getPage(db(), "9").data.schedule).toMatchObject({ action: "apply_revision" });
  });

  it("Reschedule…: starts from the current time, runs the dry run again and moves the time (POST again, a new key per open)", async () => {
    const u = user();
    schedulePage(db(), "8", { scheduled_at: at(120) }, pageEtag(8));
    const keys: Array<string | null> = [];
    server.use(http.post(`${API}/pages/8/schedule`, ({ request }) => { keys.push(request.headers.get("Idempotency-Key")); return undefined; }));
    renderPage(8);
    await u.click(await button("Reschedule…"));
    const dialog = await screen.findByRole("dialog", { name: /Change the time of this page/ });
    expect(screen.getByTestId("when")).toHaveValue("2026-11-10 12:00");
    setWhen("2026-11-12 08:00");
    await u.click(within(dialog).getByRole("button", { name: "Save new time" }));
    await waitFor(() => expect(screen.getByTestId("schedule-status")).toHaveTextContent("Scheduled for Nov 12, 2026, 8:00 AM"));
    await u.click(await button("Reschedule…"));
    setWhen("2026-11-13 08:00");
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save new time" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("Cancel schedule: a confirmation that says where it goes (draft / archived); DELETE with If-Match and NO Idempotency-Key and no body; the chip follows", async () => {
    const u = user();
    schedulePage(db(), "8", { scheduled_at: at(120) }, pageEtag(8));
    const seen: Array<{ ifMatch: string | null; key: string | null; text: string }> = [];
    server.use(
      http.delete(`${API}/pages/8/schedule`, async ({ request }) => {
        seen.push({ ifMatch: request.headers.get("If-Match"), key: request.headers.get("Idempotency-Key"), text: await request.clone().text() });
        return undefined;
      })
    );
    const onResult = vi.fn();
    renderPage(8, { onResult });
    await u.click(await button("Cancel schedule"));
    const dialog = await screen.findByRole("alertdialog", { name: "Cancel the schedule of this page?" });
    expect(dialog).toHaveTextContent("goes back to Draft");
    await u.click(within(dialog).getByRole("button", { name: "Cancel schedule" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([{ ifMatch: expect.stringMatching(/^"/), key: null, text: "" }]);
    expect(onResult.mock.calls[0][0]).toMatchObject({ action: "unschedule", data: { status: "draft", schedule: null } });
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("Draft only"));
    expect(screen.queryByTestId("schedule-status")).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Schedule cancelled.");
  });

  it("Cancel schedule of a page that was published before goes back to Archived (the text says so); a booked draft only loses its booking", async () => {
    const u = user();
    db().pages.find((p) => p.id === 10)!.status = "archived";
    schedulePage(db(), "10", { scheduled_at: at(120) }, pageEtag(10));
    const first = renderPage(10);
    await u.click(await button("Cancel schedule"));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("goes back to Archived");
    await u.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel schedule" }));
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("Archived"));
    first.unmount();

    schedulePage(db(), "9", { scheduled_at: at(120) }, pageEtag(9));
    renderPage(9);
    await u.click(await button("Cancel schedule"));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("unpublished changes stay as a draft");
    await u.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel schedule" }));
    await waitFor(() => expect(screen.queryByTestId("schedule-status")).not.toBeInTheDocument());
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Published, changes pending");
  });

  it("Publish now on a scheduled page is a normal publish (dry run, confirmation) and clears the booking", async () => {
    const u = user();
    schedulePage(db(), "8", { scheduled_at: at(120) }, pageEtag(8));
    renderPage(8);
    await u.click(await button("Publish now"));
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("Published"));
    expect(screen.queryByTestId("schedule-status")).not.toBeInTheDocument();
    expect(getPage(db(), "8").data.schedule).toBeNull();
  });

  it("Schedule is disabled with a reason while the host has unsaved edits; flush runs before the dry run and a failed save stops it", async () => {
    const u = user();
    const dirty = renderPage(8, { isDirty: true });
    const disabled = await button("Schedule…");
    expect(disabled).toBeDisabled();
    await u.hover(disabled.parentElement!);
    expect((await screen.findAllByText("Save your changes first. The saved draft is what gets published at the chosen time."))[0]).toBeInTheDocument();
    dirty.unmount();

    let dry = 0;
    server.use(http.post(`${API}/pages/8/publish`, () => { dry += 1; return undefined; }));
    renderPage(8, { flush: vi.fn().mockResolvedValue(false) });
    await u.click(await button("Schedule…"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your changes could not be saved, so nothing was scheduled."));
    expect(dry).toBe(0);
  });

  it("the dialog keeps nothing after it closes: the picked time is gone and the next open has a fresh Idempotency-Key", async () => {
    const u = user();
    renderPage(8);
    await u.click(await button("Schedule…"));
    let dialog = await screen.findByRole("dialog");
    setWhen("2026-12-01 09:30");
    await u.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await u.click(await button("Schedule…"));
    dialog = await screen.findByRole("dialog");
    expect(screen.getByTestId("when")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Schedule" })).toBeDisabled();
  });

  it("posts: an editor schedules a post (the same dialog), the answer is written through", async () => {
    const u = user();
    me.current = { id: 9, roleID: 2, permissions: grants({ "cms.blog": ["read", "update", "publish", "unpublish", "schedule", "review"] }) };
    renderApp(<PostHost id={5} />);
    await u.click(await button("Schedule…"));
    const dialog = await screen.findByRole("dialog", { name: /Schedule this post/ });
    setWhen("2026-12-01 09:30");
    await u.click(within(dialog).getByRole("button", { name: "Schedule" }));
    await waitFor(() => expect(screen.getByTestId("schedule-status")).toHaveTextContent("Scheduled for Dec 1, 2026, 9:30 AM"));
    expect(getPost(db(), "5").data).toMatchObject({ status: "scheduled", scheduled_at: "2026-12-01T09:30:00.000000+07:00" });
  });
});
