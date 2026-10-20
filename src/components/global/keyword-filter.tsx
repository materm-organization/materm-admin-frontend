"use client";

import { ChevronDown, CirclePlus, CircleX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn, truncateText } from "@/lib/utils";

// Dashed-pill Popover filter. Every feature's filters.tsx wraps this with
// its own label/placeholder.
interface Props {
  searchValue: string;
  setSearchValue: React.Dispatch<React.SetStateAction<string>>;
  onSearch: (nextValue?: string) => void;
  placeholder?: string;
  label?: string;
  instantApply?: boolean;
}
export function KeywordFilter({
  searchValue,
  setSearchValue,
  onSearch,
  placeholder = "Enter your keyword",
  label = "Search",
  instantApply = false,
}: Props) {
  const t = useTranslations("common");
  const [search, setSearch] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  // When true, skip instantApply in onOpenChange(false) — Enter already committed.
  const skipInstantApplyOnCloseRef = useRef(false);

  const commitSearch = (next: string) => {
    skipInstantApplyOnCloseRef.current = true;
    setSearch(next);
    setSearchValue(next);
    onSearch(next);
    setIsDropdownOpen(false);
  };

  return (
    <div
      className={cn(
        "flex h-7 flex-row items-center rounded-full border-2 px-1 text-gray-700 hover:bg-muted dark:border-input dark:text-foreground",
        !searchValue && "border-dashed"
      )}
    >
      {searchValue ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-0 rounded-full p-0 pr-2 hover:bg-transparent hover:text-red-600"
          onClick={() => {
            setSearchValue("");
            setSearch("");
            if (instantApply) onSearch("");
          }}
        >
          <CircleX size={16} />
        </Button>
      ) : null}
      <Popover
        open={isDropdownOpen}
        onOpenChange={(open) => {
          setIsDropdownOpen(open);
          if (open) {
            setSearch(searchValue);
            return;
          }
          if (instantApply) {
            if (skipInstantApplyOnCloseRef.current) {
              skipInstantApplyOnCloseRef.current = false;
              return;
            }
            if (searchValue === search) return;
            setSearchValue(search);
            onSearch(search);
          }
        }}
      >
        <PopoverTrigger asChild>
          <div className="flex items-center space-x-2 pr-1 text-xs">
            <CirclePlus size={16} className={!searchValue ? "block" : "hidden"} />
            <p className="text-xs">{label}</p>
            {searchValue ? (
              <>
                <div className="flex h-4 items-center space-x-4 text-sm">
                  <Separator orientation="vertical" />
                </div>
                <p className="text-xs font-medium text-primary dark:text-foreground">
                  {truncateText(searchValue, 20)}
                </p>
                <ChevronDown size={15} />
              </>
            ) : null}
          </div>
        </PopoverTrigger>
        <PopoverContent
          className={cn("mt-2 flex w-80 flex-col space-y-4", searchValue && "-ml-7")}
          align="start"
        >
          <Label>{label}</Label>
          <Input
            value={search}
            type="text"
            placeholder={placeholder}
            className="w-full"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              commitSearch(e.currentTarget.value);
            }}
          />
          {!instantApply ? (
            <Button type="button" size="sm" className="w-full" onClick={() => commitSearch(search)}>
              {t("search")}
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
