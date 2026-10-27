import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OneTimeSecretDialog } from "@/components/global/one-time-secret-dialog";
import { renderWithIntl } from "@/test/render";

describe("OneTimeSecretDialog", () => {
  it("shows the secret, a once-only warning, and Done", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<OneTimeSecretDialog secret="s3cr3t-Value" onDone={onDone} title="API key" />);

    expect(screen.getByRole("dialog", { name: "API key" })).toBeInTheDocument();
    expect(screen.getByLabelText("Secret")).toHaveValue("s3cr3t-Value");
    expect(screen.getByLabelText("Secret")).toHaveAttribute("readonly");
    expect(screen.getByText(/shown only once/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("copies to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    renderWithIntl(<OneTimeSecretDialog secret="abc" onDone={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("abc");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("cannot be dismissed by Esc, an outside click or a close button (only Done)", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<OneTimeSecretDialog secret="abc" onDone={onDone} />);
    await user.keyboard("{Escape}");
    // Radix sets `pointer-events: none` on <body> while a modal is open, so user.click() refuses; fire the events.
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("a replay without a secret shows the unavailable text and nothing to copy", () => {
    renderWithIntl(<OneTimeSecretDialog secret={null} onDone={() => {}} unavailable="Already shown, issue a new one." />);
    expect(screen.getByText("Already shown, issue a new one.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("uses the page's own texts when given", () => {
    renderWithIntl(
      <OneTimeSecretDialog
        secret="x"
        onDone={() => {}}
        title="Temporary password"
        description='Account "ann" was created.'
        label="Temporary password"
        doneLabel="Got it"
      />
    );
    expect(screen.getByText('Account "ann" was created.')).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Temporary password" })).toHaveValue("x");
    expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument();
  });
});
