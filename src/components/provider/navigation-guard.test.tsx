import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavigationGuardProvider, useGuardedNavigate } from "@/components/provider/navigation-guard";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { renderWithIntl } from "@/test/render";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/admin/things/1",
}));

function Editor({ onSave }: { onSave?: () => Promise<boolean | void> | boolean | void }) {
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty, { onSave });
  const navigate = useGuardedNavigate();
  return (
    <div>
      <button onClick={() => setDirty((d) => !d)}>toggle dirty</button>
      {/* a plain <a> on purpose: the guard must catch real anchor clicks */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/admin/users">Users</a>
      <a href="/admin/things/1#section">hash</a>
      <a href="https://example.com/x">external</a>
      <a href="/admin/blank" target="_blank" rel="noreferrer">new tab</a>
      <button onClick={() => navigate(() => router.push("/admin/back"))}>programmatic back</button>
    </div>
  );
}

function renderEditor(onSave?: () => Promise<boolean | void> | boolean | void) {
  return renderWithIntl(
    <NavigationGuardProvider>
      <Editor onSave={onSave} />
    </NavigationGuardProvider>
  );
}

beforeEach(() => {
  router.push.mockReset();
  window.history.replaceState(null, "", "/admin/things/1");
});

describe("NavigationGuardProvider (unsaved changes)", () => {
  it("lets navigation through while nothing is dirty", async () => {
    const user = userEvent.setup();
    renderEditor();
    // jsdom does not navigate on anchor clicks; the point is that nothing intercepts it.
    const onClick = vi.fn((e: MouseEvent) => e.preventDefault());
    document.addEventListener("click", onClick);
    await user.click(screen.getByRole("link", { name: "Users" }));
    document.removeEventListener("click", onClick);
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "programmatic back" }));
    expect(router.push).toHaveBeenCalledWith("/admin/back");
  });

  it("a click on an in-app link while dirty asks first; Keep editing stays", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "toggle dirty" }));
    await user.click(screen.getByRole("link", { name: "Users" }));
    expect(screen.getByRole("alertdialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("Discard changes proceeds to the link target", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "toggle dirty" }));
    await user.click(screen.getByRole("link", { name: "Users" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(router.push).toHaveBeenCalledWith("/admin/users");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("programmatic navigation is guarded too", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "toggle dirty" }));
    await user.click(screen.getByRole("button", { name: "programmatic back" }));
    expect(router.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(router.push).toHaveBeenCalledWith("/admin/back");
  });

  it("does not intercept hash-only, external or new-tab links, or modified clicks", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "toggle dirty" }));
    const swallow = (e: MouseEvent) => e.preventDefault(); // stop jsdom's "not implemented: navigation"
    document.addEventListener("click", swallow);
    await user.click(screen.getByRole("link", { name: "hash" }));
    await user.click(screen.getByRole("link", { name: "external" }));
    await user.click(screen.getByRole("link", { name: "new tab" }));
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("link", { name: "Users" }));
    await user.keyboard("{/Control}");
    document.removeEventListener("click", swallow);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("asks the browser before the tab is closed while dirty, not when clean", async () => {
    const user = userEvent.setup();
    renderEditor();
    const fire = () => {
      const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire()).toBe(false);
    await user.click(screen.getByRole("button", { name: "toggle dirty" }));
    expect(fire()).toBe(true);
    await user.click(screen.getByRole("button", { name: "toggle dirty" }));
    expect(fire()).toBe(false);
  });

  it("Save and leave runs onSave first and only leaves when it did not refuse", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderEditor(onSave);
    await user.click(screen.getByRole("button", { name: "toggle dirty" }));
    await user.click(screen.getByRole("link", { name: "Users" }));

    await user.click(screen.getByRole("button", { name: "Save and leave" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(router.push).not.toHaveBeenCalled(); // save refused -> stay
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save and leave" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin/users"));
  });

  it("offers Save and leave only when a page can save", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "toggle dirty" }));
    await user.click(screen.getByRole("link", { name: "Users" }));
    expect(screen.queryByRole("button", { name: "Save and leave" })).not.toBeInTheDocument();
  });

  it("the browser Back button asks first (best effort) and re-arms if the user stays", async () => {
    const user = userEvent.setup();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const push = vi.spyOn(window.history, "pushState");
    renderEditor();
    await user.click(screen.getByRole("button", { name: "toggle dirty" }));
    expect(push).toHaveBeenCalledTimes(1); // the spare entry

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(push).toHaveBeenCalledTimes(2); // re-armed
    expect(back).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("outside a provider", () => {
  it("the hooks are no-ops and navigation proceeds", async () => {
    const user = userEvent.setup();
    function Bare() {
      useUnsavedChangesGuard(true);
      const navigate = useGuardedNavigate();
      return <button onClick={() => navigate(() => router.push("/x"))}>go</button>;
    }
    render(<Bare />);
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(router.push).toHaveBeenCalledWith("/x");
  });
});
