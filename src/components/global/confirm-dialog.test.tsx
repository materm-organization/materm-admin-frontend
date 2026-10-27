import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { renderWithIntl } from "@/test/render";

function Harness({
  onConfirm,
  requireTyping,
}: {
  onConfirm: () => void | Promise<void>;
  requireTyping?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "open" : "closed"}</p>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete role?"
        description="This cannot be undone."
        confirmLabel="Delete"
        destructive
        requireTyping={requireTyping}
        onConfirm={onConfirm}
      />
    </>
  );
}

describe("ConfirmDialog", () => {
  it("confirms and closes", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<Harness onConfirm={onConfirm} />);
    expect(screen.getByRole("alertdialog", { name: "Delete role?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText("closed")).toBeInTheDocument());
  });

  it("cancel closes without confirming", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("closed")).toBeInTheDocument();
  });

  it("requireTyping keeps the button disabled until the exact text is typed", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<Harness onConfirm={onConfirm} requireTyping="editor" />);
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Type editor to confirm"), "edito");
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Type editor to confirm"), "r");
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("stays open when onConfirm fails", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderWithIntl(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
