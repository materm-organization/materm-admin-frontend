import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DateTimeField } from "@/components/global/date-time-field";
import { renderWithIntl } from "@/test/render";

function Harness({ initial, onChange }: { initial: string | null; onChange?: (v: string | null) => void }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <DateTimeField
      aria-label="Publish at"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe("DateTimeField (Asia/Vientiane <-> UTC)", () => {
  it("shows a UTC value as Vientiane wall-clock time", () => {
    renderWithIntl(<Harness initial="2026-10-27T03:00:00.000Z" />);
    // 03:00 UTC = 10:00 in Vientiane (UTC+7).
    expect(screen.getByRole("button", { name: "Publish at" })).toHaveTextContent(/10:00/);
  });

  it("shows the placeholder when empty", () => {
    renderWithIntl(<Harness initial={null} />);
    expect(screen.getByRole("button", { name: "Publish at" })).toHaveTextContent("Pick a date and time");
  });

  it("editing the time converts Vientiane time back to UTC", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<Harness initial="2026-10-27T03:00:00.000Z" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Publish at" }));
    const time = screen.getByLabelText("Time");
    expect(time).toHaveValue("10:00");
    await user.clear(time);
    await user.type(time, "18:30");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-27T11:30:00.000Z");
    expect(screen.getByText(/Asia\/Vientiane \(UTC\+7\)/)).toBeInTheDocument();
    expect(screen.getByText(/Sent as UTC: 2026-10-27T11:30:00.000Z/)).toBeInTheDocument();
  });

  it("picking a day first fills the time with 00:00 and emits UTC", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<Harness initial={null} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Publish at" }));
    await user.click(screen.getAllByRole("button", { name: /15/ })[0]);
    const emitted = onChange.mock.calls.at(-1)?.[0] as string;
    // Midnight in Vientiane is 17:00 UTC of the previous day.
    expect(emitted).toMatch(/T17:00:00\.000Z$/);
  });

  it("clear emits null", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<Harness initial="2026-10-27T03:00:00.000Z" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Clear date and time" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: "Publish at" })).toHaveTextContent("Pick a date and time");
  });
});
