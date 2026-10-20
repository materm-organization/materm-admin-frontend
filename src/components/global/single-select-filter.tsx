"use client";

import { ChevronDown, CirclePlus, CircleX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// One (value, display name) option for a SingleSelectFilter — kept here,
// next to its one real consumer, rather than in a new misc "global" types
// file.
export type SelectedType = { value: string; name: string };

interface Props {
  selectedValue: SelectedType | null;
  setSelectedValue: React.Dispatch<React.SetStateAction<SelectedType | null>>;
  onSearch?: () => void;
  label?: string;
  data: SelectedType[];
  setSelectSearch?: React.Dispatch<React.SetStateAction<string>>;
  isLoading?: boolean;
  instantApply?: boolean;
}

// Faceted single-select filter: dashed pill trigger, DropdownMenu with
// checkbox-square rows, optional search input, "Apply" to commit.
export function SingleSelectFilter({
  selectedValue,
  setSelectedValue,
  onSearch,
  label = "Select to filter",
  data,
  setSelectSearch,
  isLoading,
  instantApply = false,
}: Props) {
  const t = useTranslations("common");
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [selected, setSelected] = useState<SelectedType | null>(null);
  // When true, skip instantApply in onOpenChange(false) — Enter/Search already committed.
  const skipInstantApplyOnCloseRef = useRef(false);

  const commitSelection = (override?: SelectedType | null) => {
    skipInstantApplyOnCloseRef.current = true;
    setIsDropdownOpen(false);
    const applied = override === undefined ? selected : override;
    setSelectedValue(applied);
    setSelected(applied);
    onSearch?.();
  };

  const hasSelection = selectedValue !== null;

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
            setSelectedValue(null);
            setSelected(null);
            if (instantApply) onSearch?.();
          }}
        >
          <CircleX size={16} />
        </Button>
      ) : null}
      <DropdownMenu
        open={isDropdownOpen}
        onOpenChange={(open) => {
          setIsDropdownOpen(open);
          if (open) {
            setSelected(selectedValue);
            setSelectSearch?.("");
            return;
          }
          if (instantApply) {
            if (skipInstantApplyOnCloseRef.current) {
              skipInstantApplyOnCloseRef.current = false;
              return;
            }
            const isSame =
              (selectedValue?.value ?? "") === (selected?.value ?? "") &&
              (selectedValue?.name ?? "") === (selected?.name ?? "");
            if (isSame) return;
            setSelectedValue(selected);
            onSearch?.();
          }
        }}
      >
        <DropdownMenuTrigger
          asChild
          className="border-0 ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <div className="flex items-center space-x-2 pr-1 text-xs">
            <CirclePlus size={16} className={!hasSelection ? "block" : "hidden"} />
            <p className="text-xs">{label}</p>
            {hasSelection && selectedValue ? (
              <>
                <div className="flex h-4 items-center space-x-4 text-sm">
                  <Separator orientation="vertical" />
                </div>
                <p className="text-xs text-primary dark:text-foreground">
                  <span className="font-medium">{selectedValue.name}</span>
                </p>
                <ChevronDown size={15} />
              </>
            ) : null}
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className={cn("mt-2 w-72", hasSelection && "-ml-7")}
          align="start"
          onKeyDownCapture={(e) => {
            if (instantApply) return;
            if (e.key !== "Enter") return;
            if ("isComposing" in e && e.isComposing) return;
            const el = e.target as HTMLElement | null;
            if (!el || el.tagName === "INPUT") return;
            const menuItem = el.closest('[role="menuitem"]');
            if (!menuItem) return;
            const value = menuItem.getAttribute("data-ssf-value");
            if (value === null) return;
            const row = data.find((d) => d.value === value);
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            commitSelection({ value: row.value, name: row.name });
          }}
        >
          {setSelectSearch ? (
            <>
              <DropdownMenuLabel>
                <Input
                  type="text"
                  // Hardcoded Lao "search for" prefix — like nav-main.tsx's
                  // hardcoded "Menu" label, rendered untranslated
                  // regardless of locale.
                  placeholder={`ຄົ້ນຫາ${label}...`}
                  onChange={(e) => setSelectSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    if ("isComposing" in e && e.isComposing) return;
                    e.preventDefault();
                    commitSelection();
                  }}
                  className="bg-white"
                />
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <div className="p-2 text-sm font-semibold">{label}</div>
            <DropdownMenuSeparator />
            <div>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <DropdownMenuItem key={index} disabled>
                    <div className="flex w-full items-center gap-2">
                      <Skeleton className="size-6 rounded-sm" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  </DropdownMenuItem>
                ))
              ) : data.length === 0 ? (
                <div className="py-5 text-center text-sm">
                  {t("notFound")} {label}
                </div>
              ) : (
                data.map((item, index) => {
                  const isSelected = selected?.value === item.value;
                  return (
                    <DropdownMenuItem
                      key={index}
                      data-ssf-value={item.value}
                      className="cursor-pointer"
                      onSelect={(e) => {
                        e.preventDefault();
                        const selectedItem = data.find((opt) => opt.value === item.value);
                        if (selectedItem) {
                          setSelected(
                            isSelected ? null : { value: selectedItem.value, name: selectedItem.name }
                          );
                        }
                      }}
                    >
                      <div className="flex size-6 items-center justify-center rounded-sm border">
                        <div
                          className={cn("size-3 rounded-sm", isSelected ? "bg-primary" : "bg-muted")}
                        />
                      </div>
                      <div>{item?.name}</div>
                    </DropdownMenuItem>
                  );
                })
              )}
            </div>
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
          {!instantApply ? (
            <div className="px-4 py-2">
              <Button type="button" className="w-full" size="sm" onClick={() => commitSelection()}>
                {t("search")}
              </Button>
            </div>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
