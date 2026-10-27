"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A reorderable list (doc/07 sections 5.2, 5.6). Three ways to move an item, all announced in a polite
// live region ("Moved Item 2 to position 1 of 3"):
//   - drag the handle with the pointer;
//   - keyboard on the handle (dnd-kit): Space / Enter picks it up, arrows move, Space drops, Esc cancels;
//   - the always-visible "move up" / "move down" buttons (also what Testing Library drives).
// It only reports `onMove(from, to)`; the caller owns the array and the stable item ids.

export type SortableItemControls = {
  index: number;
  isFirst: boolean;
  isLast: boolean;
  isDragging: boolean;
  // Handle + up + down buttons, ready to place in the item header.
  controls: ReactNode;
};

export type SortableListProps = {
  // Stable ids, one per item, in display order (must not be the index).
  ids: string[];
  onMove: (from: number, to: number) => void;
  renderItem: (id: string, item: SortableItemControls) => ReactNode;
  // Name of an item for assistive text ("Item 3" / the item's title).
  itemLabel: (index: number) => string;
  layout?: "vertical" | "grid";
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
};

export function SortableList({
  ids,
  onMove,
  renderItem,
  itemLabel,
  layout = "vertical",
  disabled = false,
  className,
  itemClassName,
}: SortableListProps) {
  const t = useTranslations("sortable");
  const [message, setMessage] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // `scrollBehavior: auto`: tall cards make the keyboard sensor scroll the page; instantly (no smooth animation,
    // which also respects reduced-motion users) so the item under the dragged one is detected at once.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: "auto" })
  );

  const announce = useCallback(
    (index: number, to: number) =>
      t("moved", { item: itemLabel(index), position: to + 1, total: ids.length }),
    [ids.length, itemLabel, t]
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= ids.length || from === to) return;
      onMove(from, to);
      setMessage(announce(from, to));
    },
    [announce, ids.length, onMove]
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  }

  const nameOf = (id: string | number) => itemLabel(Math.max(0, ids.indexOf(String(id))));
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dragStart", { item: nameOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("dragOver", { item: nameOf(active.id), position: ids.indexOf(String(over.id)) + 1, total: ids.length }) : undefined,
    onDragEnd: ({ active, over }) =>
      over ? t("dragEnd", { item: nameOf(active.id), position: ids.indexOf(String(over.id)) + 1, total: ids.length }) : t("dragCancel", { item: nameOf(active.id) }),
    onDragCancel: ({ active }) => t("dragCancel", { item: nameOf(active.id) }),
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: t("instructions") },
        }}
      >
        <SortableContext items={ids} strategy={layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy} disabled={disabled}>
          <ul
            className={cn(layout === "grid" ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-col gap-3", className)}
            aria-label={t("list")}
          >
            {ids.map((id, index) => (
              <SortableRow
                key={id}
                id={id}
                index={index}
                count={ids.length}
                label={itemLabel(index)}
                disabled={disabled}
                className={itemClassName}
                onMove={move}
                render={renderItem}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>
    </>
  );
}

function SortableRow({
  id,
  index,
  count,
  label,
  disabled,
  className,
  onMove,
  render,
}: {
  id: string;
  index: number;
  count: number;
  label: string;
  disabled: boolean;
  className?: string;
  onMove: (from: number, to: number) => void;
  render: SortableListProps["renderItem"];
}) {
  const t = useTranslations("sortable");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const isFirst = index === 0;
  const isLast = index === count - 1;

  const controls = disabled ? null : (
    <div className="flex items-center gap-0.5" data-slot="sortable-controls">
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 cursor-grab touch-none"
        aria-label={t("handle", { item: label })}
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={t("moveUp", { item: label })}
        disabled={isFirst}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={t("moveDown", { item: label })}
        disabled={isLast}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDownIcon />
      </Button>
    </div>
  );

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("list-none", isDragging && "relative z-10 opacity-80", className)}
    >
      {render(id, { index, isFirst, isLast, isDragging, controls })}
    </li>
  );
}

export { arrayMove };
