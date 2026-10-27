import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConflictDialog } from "@/components/global/conflict-dialog";
import { renderWithIntl } from "@/test/render";

function setup(props: Partial<React.ComponentProps<typeof ConflictDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onReload = vi.fn();
  const onKeepMine = vi.fn();
  renderWithIntl(
    <ConflictDialog
      open
      onOpenChange={onOpenChange}
      onReload={onReload}
      onKeepMine={onKeepMine}
      {...props}
    />
  );
  return { onOpenChange, onReload, onKeepMine, user: userEvent.setup() };
}

describe("ConflictDialog (409 CONFLICT_LOCK_VERSION / 412)", () => {
  it("explains the conflict and offers reload or keeping my changes, with no force-overwrite", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Someone else changed this item" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Load the latest version/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep my changes to review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /overwrite|force/i })).not.toBeInTheDocument();
  });

  it("reload calls onReload and closes", async () => {
    const { user, onReload, onOpenChange } = setup();
    await user.click(screen.getByRole("button", { name: /Load the latest version/ }));
    expect(onReload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keep mine without a change list just closes and tells the caller", async () => {
    const { user, onKeepMine, onOpenChange, onReload } = setup();
    await user.click(screen.getByRole("button", { name: "Keep my changes to review" }));
    expect(onKeepMine).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onReload).not.toHaveBeenCalled();
  });

  it("keep mine with a change list shows my values read-only, then can still reload", async () => {
    const { user, onReload } = setup({
      myChanges: [
        { label: "Name", value: "Editor role" },
        { label: "Description", value: "line 1\nline 2" },
      ],
    });
    await user.click(screen.getByRole("button", { name: "Keep my changes to review" }));
    expect(screen.getByRole("dialog", { name: "My changes" })).toBeInTheDocument();
    expect(screen.getByText("Editor role")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(onReload).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Someone else changed this item" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep my changes to review" }));
    await user.click(screen.getByRole("button", { name: /Load the latest version/ }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("cannot be dismissed while reloading", async () => {
    const { user, onOpenChange } = setup({ isReloading: true });
    expect(screen.getByRole("button", { name: /Load the latest version/ })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
