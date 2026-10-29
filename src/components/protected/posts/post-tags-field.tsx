"use client";

import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTags } from "@/hooks/use-taxonomy";
import { MAX_TAGS } from "@/lib/posts";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types/taxonomy";

const tagName = (tag: Tag, ui: string, fallback: string) => tag.translations[ui]?.name ?? tag.translations[fallback]?.name ?? tag.key;

// The tags of a post: 0 - 10, a searchable list with check marks and the chosen ones as removable chips. A tag in the trash
// is not offered (the server would answer 422 `unknown_reference`); one already on the post stays until removed.
export function PostTagsField({
  id,
  value,
  onChange,
  disabled,
  defaultLocale,
  tagRefs,
}: {
  id: string;
  value: number[];
  onChange: (ids: number[]) => void;
  disabled: boolean;
  defaultLocale: string;
  // Names of the tags the post already has (from the server's answer), shown while the list loads.
  tagRefs: Array<{ id: number; key: string; name: string | null }>;
}) {
  const t = useTranslations("posts.details");
  const ui = useLocale();
  const [open, setOpen] = useState(false);
  const tags = useTags({ limit: 100 });
  const rows = tags.data?.data ?? [];
  const nameOf = (tid: number) => {
    const row = rows.find((r) => r.id === tid);
    if (row) return tagName(row, ui, defaultLocale);
    const ref = tagRefs.find((r) => r.id === tid);
    return ref?.name ?? ref?.key ?? `#${tid}`;
  };
  const full = value.length >= MAX_TAGS;
  const toggle = (tid: number) => onChange(value.includes(tid) ? value.filter((x) => x !== tid) : value.length >= MAX_TAGS ? value : [...value, tid]);

  return (
    <div className="space-y-2" data-testid="post-tags">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full justify-between font-normal">
            <span className="truncate text-muted-foreground">{value.length === 0 ? t("tagsPlaceholder") : t("tagsCount", { count: value.length, max: MAX_TAGS })}</span>
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            <CommandInput placeholder={t("tagsSearch")} />
            <CommandList>
              <CommandEmpty>{tags.isLoading ? t("tagsLoading") : t("tagsNone")}</CommandEmpty>
              <CommandGroup>
                {rows
                  .filter((r) => !r.deleted_at)
                  .map((r) => {
                    const selected = value.includes(r.id);
                    return (
                      <CommandItem key={r.id} value={`${tagName(r, ui, defaultLocale)} ${r.key}`} disabled={!selected && full} onSelect={() => toggle(r.id)}>
                        <CheckIcon className={cn("size-4", selected ? "opacity-100" : "opacity-0")} aria-hidden />
                        {tagName(r, ui, defaultLocale)}
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            </CommandList>
          </Command>
          {full ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t("tagsFull", { max: MAX_TAGS })}</p> : null}
        </PopoverContent>
      </Popover>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("tags")}>
          {value.map((tid) => (
            <li key={tid}>
              <Badge variant="secondary" className="gap-1 pe-1">
                {nameOf(tid)}
                {disabled ? null : (
                  <button type="button" className="rounded-sm p-0.5 hover:bg-background/60" aria-label={t("tagRemove", { name: nameOf(tid) })} onClick={() => toggle(tid)}>
                    <XIcon className="size-3" aria-hidden />
                  </button>
                )}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
