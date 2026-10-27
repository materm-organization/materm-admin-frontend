"use client";

import { ChevronDownIcon, ChevronRightIcon, CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { arrayMove, SortableList } from "@/components/global/sortable-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { useFieldLabel, useIssuesAt, useIssuesUnder, useSchemaFormContext } from "../context";
import { isDescendantOrSelf, joinPointer } from "../pointer";
import { isPlainObject } from "../schema-walker";
import type { FieldNode } from "../types";
import { hasTextInOtherLocales, newItemValue } from "../value-ops";
import { GroupShell } from "./field-shell";
import { FieldRenderer, ObjectChildren } from "./field-renderer";

// Stable keys for the items (an item has no id of its own): the list reorders, inserts and removes in step
// with the value, so a widget keeps its state (open, focus, an editor's undo history) while it moves.
let idCounter = 0;
const newId = () => `i${++idCounter}`;

function useItemIds(length: number) {
  const [ids, setIds] = useState<string[]>(() => Array.from({ length }, newId));
  let current = ids;
  if (ids.length !== length) {
    // The value changed from outside (reset, restore): make as many ids as there are items.
    current = length > ids.length ? [...ids, ...Array.from({ length: length - ids.length }, newId)] : ids.slice(0, length);
    setIds(current);
  }
  return { ids: current, setIds };
}

function padTo(items: unknown[], count: number): unknown[] {
  return items.length >= count ? items : [...items, ...Array.from({ length: count - items.length }, () => ({}))];
}

// First text of an item, for its card title (the first localized text in the chosen language, then the default
// language, then any).
const SUMMARY_MAX = 48;

function itemSummary(node: FieldNode, value: unknown, locale: string, defaultLocale: string): string | undefined {
  if (node.kind === "localized-text" && isPlainObject(value)) {
    const pick = [value[locale], value[defaultLocale], ...Object.values(value)].find((v) => typeof v === "string" && v.trim());
    if (typeof pick !== "string") return undefined;
    const oneLine = pick.replace(/\s+/g, " ").trim();
    const chars = Array.from(oneLine);
    return chars.length > SUMMARY_MAX ? `${chars.slice(0, SUMMARY_MAX).join("")}…` : oneLine;
  }
  if (node.kind === "object" && isPlainObject(value)) {
    for (const child of node.children) {
      const found = itemSummary(child, value[child.name], locale, defaultLocale);
      if (found) return found;
    }
  }
  return undefined;
}

export function ArrayField({
  node,
  pointer,
  value,
  onChange,
  editable,
}: {
  node: FieldNode;
  pointer: string;
  value: unknown;
  onChange: (next: unknown) => void;
  editable: boolean;
}) {
  const t = useTranslations("schemaForm.array");
  const { rootSchema, locale, defaultLocale, reveal } = useSchemaFormContext();
  const label = useFieldLabel(node);
  const issues = useIssuesAt([pointer]);
  const item = node.item as FieldNode;
  const stored = Array.isArray(value) ? value : [];
  // A fixed-size array whose slots cannot be added or removed (the 3 collage photos) always shows its slots.
  const fixed = !node.options.addable && !node.options.removable && node.minItems !== undefined;
  const items = fixed ? padTo(stored, node.minItems as number) : stored;
  const { ids, setIds } = useItemIds(items.length);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pendingRemove, setPendingRemove] = useState<number | null>(null);
  const idsRef = useRef(ids);
  useEffect(() => {
    idsRef.current = ids;
  });

  const canAdd = editable && node.options.addable && (node.maxItems === undefined || items.length < node.maxItems);
  const canRemove = editable && node.options.removable && items.length > (node.minItems ?? 0);
  const canOrder = editable && node.options.orderable && items.length > 1;
  const grid = item.kind === "image";

  // Open an item that holds the field the form wants to show (first server error, "go to field").
  useEffect(() => {
    if (!reveal) return;
    const index = items.findIndex((_, i) => isDescendantOrSelf(reveal.pointer, joinPointer(pointer, i)));
    if (index < 0) return;
    const id = idsRef.current[index];
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.token]);

  const itemName = useCallback(
    (index: number) => itemSummary(item, items[index], locale, defaultLocale) ?? t("itemFallback", { number: index + 1 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, value, locale, defaultLocale, t]
  );

  const add = () => {
    onChange([...items, newItemValue(item)]);
    setIds((prev) => [...prev, newId()]);
  };
  const duplicate = (index: number) => {
    const copy = items.slice();
    copy.splice(index + 1, 0, structuredClone(items[index]));
    onChange(copy);
    setIds((prev) => {
      const next = prev.slice();
      next.splice(index + 1, 0, newId());
      return next;
    });
  };
  const remove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
    setIds((prev) => prev.filter((_, i) => i !== index));
  };
  const move = (from: number, to: number) => {
    onChange(arrayMove(items, from, to));
    setIds((prev) => arrayMove(prev, from, to));
  };
  const askRemove = (index: number) => {
    // The array is shared by every language: confirm when removing it would drop text of another language.
    if (hasTextInOtherLocales(rootSchema, item.schema, items[index], locale)) setPendingRemove(index);
    else remove(index);
  };

  return (
    <GroupShell
      pointer={pointer}
      label={label}
      required={node.required}
      description={node.description}
      issues={issues}
      actions={
        <span className="text-xs text-muted-foreground">
          {node.maxItems !== undefined ? t("countOf", { count: items.length, max: node.maxItems }) : t("count", { count: items.length })}
        </span>
      }
    >
      {items.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      <SortableList
        ids={ids}
        onMove={move}
        itemLabel={itemName}
        layout={grid ? "grid" : "vertical"}
        disabled={!canOrder}
        renderItem={(id, { index, controls }) => (
          <ArrayItem
            node={item}
            pointer={joinPointer(pointer, index)}
            value={items[index]}
            title={itemName(index)}
            controls={controls}
            open={!collapsed.has(id)}
            onOpenChange={(open) =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (open) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            actions={
              <>
                {canAdd && (
                  <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t("duplicate", { item: itemName(index) })} onClick={() => duplicate(index)}>
                    <CopyIcon />
                  </Button>
                )}
                {canRemove && (
                  <Button type="button" variant="ghost" size="icon" className="size-7 text-destructive" aria-label={t("remove", { item: itemName(index) })} onClick={() => askRemove(index)}>
                    <Trash2Icon />
                  </Button>
                )}
              </>
            }
          />
        )}
      />
      {canAdd && (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={add}>
          <PlusIcon />
          {t("add")}
        </Button>
      )}
      {node.maxItems !== undefined && items.length >= node.maxItems && node.options.addable && (
        <p className="text-xs text-muted-foreground">{t("maxReached", { max: node.maxItems })}</p>
      )}
      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title={t("removeConfirmTitle")}
        description={t("removeConfirmDescription")}
        confirmLabel={t("removeConfirm")}
        destructive
        onConfirm={() => {
          if (pendingRemove !== null) remove(pendingRemove);
          setPendingRemove(null);
        }}
      />
    </GroupShell>
  );
}

function ArrayItem({
  node,
  pointer,
  value,
  title,
  controls,
  actions,
  open,
  onOpenChange,
}: {
  node: FieldNode;
  pointer: string;
  value: unknown;
  title: string;
  controls: React.ReactNode;
  actions: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("schemaForm.array");
  const { disabled, translateOnly } = useSchemaFormContext();
  const issues = useIssuesUnder(pointer);
  const toggleLabel = open ? t("collapse", { item: title }) : t("expand", { item: title });
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={cn("rounded-md border bg-card", issues.length > 0 && "border-destructive")} data-field-pointer={pointer}>
      <div className="flex items-center gap-1 px-2 py-1.5">
        {controls}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 flex-1 justify-start gap-1 px-1"
          aria-expanded={open}
          aria-label={toggleLabel}
          onClick={() => onOpenChange(!open)}
        >
          {open ? <ChevronDownIcon className="size-4 shrink-0" /> : <ChevronRightIcon className="size-4 shrink-0" />}
          <span className="truncate text-sm font-medium">{title}</span>
        </Button>
        {issues.length > 0 && (
          <Badge variant="destructive" aria-label={t("issues", { count: issues.length })}>
            {issues.length}
          </Badge>
        )}
        {!disabled && !translateOnly && actions}
      </div>
      <CollapsibleContent className="border-t p-3">
        {node.kind === "object" ? (
          <ObjectChildren node={node} pointer={pointer} value={value} />
        ) : (
          <FieldRenderer node={node} pointer={pointer} value={value} />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
