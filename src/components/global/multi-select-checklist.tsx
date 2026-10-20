"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, CirclePlus, CircleX } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Multi-select, search-in-popup faceted filter, matching the filter-bar
// convention: the dashed-pill trigger
// (components/global/single-select-filter.tsx), with a Popover+Command
// instead of a DropdownMenu so a search box and checkbox rows both fit.
// There is no chip row: in a horizontal filter bar a growing chip row
// would push the bar's height around per filter; the trigger's
// "N selected" summary (`${n} selected`) already answers "how many", and
// the popup's checked rows answer "which ones".
//
// `value`/`name` (not `value`/`label`) matches `SelectedType`
// (single-select-filter.tsx) — same (value, display name) pair shape, so
// callers that already build `SelectedType[]` option lists for
// `SingleSelectFilter` don't need a different shape here.
export type MultiSelectOption = { value: string; name: string };

interface Props {
  data: MultiSelectOption[];
  selectedValues: MultiSelectOption[];
  setSelectedValues: React.Dispatch<React.SetStateAction<MultiSelectOption[]>>;
  onSearch?: () => void;
  label?: string;
  // Same live-search-callback shape as SingleSelectFilter's own
  // `setSelectSearch` (see components/protected/user/filters.tsx's role
  // filter: `setSelectSearch={setRoleSearch}` feeding `useFetchRoles({
  // keyword: roleSearch })`) — the actual "search beyond what's already
  // fetched" mechanism in this repo. `Command`'s own built-in client-side
  // fuzzy filter is disabled (`shouldFilter={false}`) whenever this is
  // provided, since `data` is then assumed to already be the server's
  // keyword-filtered result, not a client-filterable superset.
  setSelectSearch?: React.Dispatch<React.SetStateAction<string>>;
  isLoading?: boolean;
  instantApply?: boolean;
  // Standard controlled/uncontrolled hybrid for the popover's open state.
  // Omitted (the common case — matches every other filter in this repo,
  // none of which need to be opened/closed from outside), the popover
  // manages its own `isOpen` exactly as before. Passed (e.g. by a "use
  // this value" button elsewhere on the page that needs to force the
  // popover shut after writing a new selection), this component defers to
  // the caller instead of tracking open state itself.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Fixed 300ms search debounce, so a keyword lookup against a live backend
// isn't fired once per keystroke.
const SEARCH_DEBOUNCE_MS = 300;

// Faceted multi-select filter with an in-popup search box — same
// (draft-until-committed, "Apply" button unless `instantApply`) commit
// flow as SingleSelectFilter, just toggling membership in an array
// instead of swapping a single value. Selection is kept as full
// `{ value, name }` pairs (not just ids) so a round picked while searching
// keeps its label — and stays checked/visible, pinned above the current
// `data` page — even after the search box is cleared and `data` reverts to
// the default list (rather than silently dropping any id no longer present
// in the current `data` prop).
export function MultiSelectChecklist({
  data,
  selectedValues,
  setSelectedValues,
  onSearch,
  label = "Select to filter",
  setSelectSearch,
  isLoading,
  instantApply = false,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: Props) {
  const t = useTranslations("common");
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpenControlled = openProp !== undefined;
  const isOpen = isOpenControlled ? openProp : internalOpen;
  const setIsOpen = (next: boolean) => {
    if (isOpenControlled) {
      onOpenChangeProp?.(next);
    } else {
      setInternalOpen(next);
    }
  };
  const [selected, setSelected] = useState<MultiSelectOption[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const skipInstantApplyOnCloseRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Keeps the draft `selected` in sync with the committed `selectedValues`
  // prop whenever it changes while the popover is CLOSED — not only at the
  // moment it's opened (the `onOpenChange` handler below already covers
  // that). Without this, an external write to `selectedValues` (e.g. a
  // "use this value" button elsewhere on the page) while the popover
  // happens to be open would update the trigger's own "{n} selected" text
  // (which reads `selectedValues` directly) but leave the popup's own
  // checkbox rows showing a stale draft, since those render from
  // `selected`, not `selectedValues`. Combined with the controlled `open`
  // prop above (which that same external caller can also force closed),
  // this guarantees that by the time the popover is next opened, its
  // draft matches whatever was last written in, not a leftover
  // uncommitted draft from before.
  //
  // Adjusted during render (the "store the previous prop value, compare,
  // and adjust" pattern React's own docs recommend — see
  // https://react.dev/learn/you-might-not-need-an-effect), not in a
  // `useEffect`: this repo's lint rules (`react-hooks/set-state-in-effect`)
  // reject a plain effect-based sync here the same way they rejected an
  // effect-based version of tabs-content.tsx's own default-round logic.
  const [prevSelectedValues, setPrevSelectedValues] = useState(selectedValues);
  if (selectedValues !== prevSelectedValues) {
    setPrevSelectedValues(selectedValues);
    if (!isOpen) setSelected(selectedValues);
  }

  function toggle(option: MultiSelectOption) {
    setSelected((prev) =>
      prev.some((o) => o.value === option.value) ? prev.filter((o) => o.value !== option.value) : [...prev, option]
    );
  }

  function handleSearchInputChange(value: string) {
    setSearchInput(value);
    if (!setSelectSearch) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSelectSearch(value), SEARCH_DEBOUNCE_MS);
  }

  const commitSelection = (override?: MultiSelectOption[]) => {
    skipInstantApplyOnCloseRef.current = true;
    setIsOpen(false);
    const applied = override ?? selected;
    setSelectedValues(applied);
    setSelected(applied);
    onSearch?.();
  };

  const isSameSelection = (a: MultiSelectOption[], b: MultiSelectOption[]) =>
    a.length === b.length && a.every((option) => b.some((other) => other.value === option.value));

  const hasSelection = selectedValues.length > 0;

  // Selected rounds not in the current `data` page (e.g. picked via an
  // earlier search, now cleared back to the default list) are pinned above
  // it, so they stay visible/checked instead of silently disappearing —
  // see the function's own doc comment above.
  const pinnedSelected = selected.filter((option) => !data.some((item) => item.value === option.value));
  const rows = [...pinnedSelected, ...data];

  return (
    <div
      className={cn(
        "flex h-7 flex-row items-center rounded-full border-2 px-1 text-gray-700 hover:bg-muted dark:border-input dark:text-foreground",
        !hasSelection && "border-dashed"
      )}
    >
      {hasSelection ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-0 rounded-full p-0 pr-2 hover:bg-transparent hover:text-red-600"
          onClick={() => {
            setSelectedValues([]);
            setSelected([]);
            if (instantApply) onSearch?.();
          }}
        >
          <CircleX size={16} />
        </Button>
      ) : null}
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (open) {
            setSelected(selectedValues);
            setSearchInput("");
            setSelectSearch?.("");
            return;
          }
          if (debounceRef.current) clearTimeout(debounceRef.current);
          if (instantApply) {
            if (skipInstantApplyOnCloseRef.current) {
              skipInstantApplyOnCloseRef.current = false;
              return;
            }
            if (isSameSelection(selected, selectedValues)) return;
            setSelectedValues(selected);
            onSearch?.();
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center space-x-2 border-0 pr-1 text-xs ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          >
            <CirclePlus size={16} className={!hasSelection ? "block" : "hidden"} />
            <p className="text-xs">{label}</p>
            {hasSelection ? (
              <>
                <div className="flex h-4 items-center space-x-4 text-sm">
                  <Separator orientation="vertical" />
                </div>
                <p className="text-xs text-primary dark:text-foreground">
                  <span className="font-medium">{t("selectedCount", { count: selectedValues.length })}</span>
                </p>
                <ChevronDown size={15} />
              </>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter={!setSelectSearch}>
            <CommandInput
              value={searchInput}
              onValueChange={handleSearchInputChange}
              placeholder={`${t("search")} ${label}...`}
            />
            <CommandList className="max-h-60">
              {isLoading ? (
                <div className="space-y-1 p-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="flex items-center gap-2 px-2 py-1.5">
                      <Skeleton className="size-4 rounded-sm" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <CommandEmpty>
                  {t("notFound")} {label}
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {rows.map((option) => {
                    const checked = selected.some((o) => o.value === option.value);
                    return (
                      <CommandItem
                        key={option.value}
                        value={option.name}
                        onSelect={() => toggle(option)}
                        className="cursor-pointer gap-2"
                      >
                        <Checkbox checked={checked} className="pointer-events-none" />
                        {option.name}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
            {!instantApply ? (
              <div className="border-t p-2">
                <Button type="button" className="w-full" size="sm" onClick={() => commitSelection()}>
                  {t("search")}
                </Button>
              </div>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
