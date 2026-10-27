"use client";

import { ChevronsUpDownIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { EntityOption } from "@/types/cms";

import { useEntity, useEntityOptions } from "../data/provider";
import type { LookupKind } from "../data/types";
import { useDebouncedValue } from "./use-debounced";

// Picks a row of another table (an `x-ref`): Popover + Command (cmdk) with an asynchronous, lazy search
// (doc/07 section 4.3). The chosen row is shown as a chip with its name, key and status, loaded by id /
// key / slug when the page opens. A row that is not published is flagged: the portal skips it.
export type EntityPickerProps = {
  kind: LookupKind;
  value: number | string | undefined;
  onChange: (value: number | string | undefined) => void;
  disabled?: boolean;
  // `albumItem`: the album whose items are offered. Undefined = "pick the album first".
  albumId?: number;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "data-field-pointer"?: string;
  // Allow clearing even for a required field (a half-filled form saves in draft).
  clearable?: boolean;
};

export function EntityPicker({
  kind,
  value,
  onChange,
  disabled,
  albumId,
  id,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "data-field-pointer": fieldPointer,
  clearable = true,
}: EntityPickerProps) {
  const t = useTranslations("schemaForm.entity");
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const debounced = useDebouncedValue(keyword, 250);
  const needsAlbum = kind === "albumItem" && !albumId;
  const options = useEntityOptions(kind, debounced, open && !needsAlbum, albumId);
  const selected = useEntity(kind, value, { albumId });

  const pick = (option: EntityOption) => {
    onChange(option.value);
    setOpen(false);
    setKeyword("");
  };

  const chip = selected.data;
  const stateLabel =
    value === undefined || value === ""
      ? t("choose")
      : selected.isLoading
        ? t("loading")
        : (chip?.label ?? t("missing", { value: String(value) }));

  return (
    <div className="flex items-center gap-1.5" data-slot="entity-picker">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel ? `${ariaLabel}: ${stateLabel}` : undefined}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            data-field-pointer={fieldPointer}
            variant="outline"
            disabled={disabled || needsAlbum}
            className={cn("min-w-0 flex-1 justify-between gap-2 font-normal", value === undefined && "text-muted-foreground")}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{needsAlbum ? t("pickAlbumFirst") : stateLabel}</span>
              {chip?.hint && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{chip.hint}</span>}
            </span>
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={keyword} onValueChange={setKeyword} placeholder={t("search")} aria-label={t("search")} />
            <CommandList>
              {options.isLoading ? (
                <div className="space-y-2 p-2">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                </div>
              ) : options.isError ? (
                <p role="alert" className="p-3 text-sm text-destructive">
                  {t("loadError")}
                </p>
              ) : (
                <>
                  <CommandEmpty>{t("empty")}</CommandEmpty>
                  <CommandGroup>
                    {(options.data ?? []).map((option) => (
                      <CommandItem key={String(option.value)} value={String(option.value)} onSelect={() => pick(option)}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{option.label}</span>
                          {option.hint && <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>}
                        </span>
                        {option.status && option.status !== "published" && (
                          <Badge variant="outline" className="shrink-0">
                            {option.status}
                          </Badge>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value !== undefined && value !== "" && clearable && !disabled && (
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("clear")} onClick={() => onChange(undefined)}>
          <XIcon />
        </Button>
      )}
    </div>
  );
}

// Why a picked row may not appear on the site, or null when it is fine / unknown.
export function useEntityWarning(kind: LookupKind, value: number | string | undefined, albumId?: number): string | null {
  const t = useTranslations("schemaForm.entity");
  const { data } = useEntity(kind, value, { albumId });
  if (!data?.status || data.status === "published") return null;
  if (kind === "post") return t("warnPost", { status: data.status });
  if (kind === "page") return t("warnPage", { status: data.status });
  return t("warnOther", { status: data.status });
}
