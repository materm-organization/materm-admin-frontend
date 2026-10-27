import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../i18n/en.json";
import { arrayMove, SortableList } from "./sortable-list";

function Harness({ initial, onMove }: { initial: string[]; onMove?: (from: number, to: number) => void }) {
  const [items, setItems] = useState(initial);
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Vientiane">
      <SortableList
        ids={items.map((i) => `id-${i}`)}
        itemLabel={(index) => items[index]}
        onMove={(from, to) => {
          onMove?.(from, to);
          setItems((prev) => arrayMove(prev, from, to));
        }}
        renderItem={(id, { controls, index }) => (
          <div data-testid={`row-${index}`}>
            {controls}
            <span>{items[index]}</span>
          </div>
        )}
      />
    </NextIntlClientProvider>
  );
}

const order = () => screen.getAllByTestId(/row-/).map((r) => r.textContent?.trim());

describe("SortableList", () => {
  it("moves with the up / down buttons and announces the new position", async () => {
    const u = userEvent.setup();
    const onMove = vi.fn();
    render(<Harness initial={["A", "B", "C"]} onMove={onMove} />);
    await u.click(screen.getByRole("button", { name: "Move C up" }));
    expect(onMove).toHaveBeenCalledWith(2, 1);
    expect(order()).toEqual(["A", "C", "B"]);
    expect(screen.getAllByRole("status").map((e) => e.textContent)).toContain("Moved C to position 2 of 3");
    await u.click(screen.getByRole("button", { name: "Move A down" }));
    expect(order()).toEqual(["C", "A", "B"]);
  });

  it("the first item cannot move up, the last cannot move down", () => {
    render(<Harness initial={["A", "B"]} />);
    expect(screen.getByRole("button", { name: "Move A up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move B down" })).toBeDisabled();
  });

  it("every item has a keyboard-focusable drag handle with instructions", () => {
    render(<Harness initial={["A", "B"]} />);
    const handle = screen.getByRole("button", { name: "Reorder A: press Space to pick it up" });
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    expect(handle).toHaveAttribute("tabindex", "0");
  });
});

describe("SortableList: keyboard drag with dnd-kit", () => {
  // jsdom has no layout; give each row a position so the keyboard sensor can find its neighbours.
  const original = Element.prototype.getBoundingClientRect;
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const li = this.closest("li");
      const index = li ? Array.from(li.parentElement?.children ?? []).indexOf(li) : 0;
      const top = this.tagName === "LI" ? index * 60 : index * 60 + 5;
      return { x: 0, y: top, top, left: 0, right: 300, bottom: top + 50, width: 300, height: 50, toJSON: () => ({}) } as DOMRect;
    };
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = original;
  });

  it("Space picks up, ArrowDown moves, Space drops", async () => {
    const u = userEvent.setup();
    const onMove = vi.fn();
    render(<Harness initial={["A", "B", "C"]} onMove={onMove} />);
    const handle = screen.getByRole("button", { name: "Reorder A: press Space to pick it up" });
    await act(async () => handle.focus());
    await u.keyboard(" ");
    await u.keyboard("{ArrowDown}");
    await u.keyboard(" ");
    expect(onMove).toHaveBeenCalledWith(0, 1);
    expect(order()).toEqual(["B", "A", "C"]);
  });

  it("Escape cancels", async () => {
    const u = userEvent.setup();
    const onMove = vi.fn();
    render(<Harness initial={["A", "B", "C"]} onMove={onMove} />);
    await act(async () => screen.getByRole("button", { name: "Reorder A: press Space to pick it up" }).focus());
    await u.keyboard(" ");
    await u.keyboard("{ArrowDown}");
    await u.keyboard("{Escape}");
    expect(onMove).not.toHaveBeenCalled();
    expect(order()).toEqual(["A", "B", "C"]);
  });
});
