"use client";

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, type ReactNode } from "react";

import { KeywordFilter } from "@/components/global/keyword-filter";
import { Button } from "@/components/ui/button";
import { MAX_KEYWORD_LENGTH } from "@/lib/list-params";

// Keyword filter: the same dashed chip as the other filters; it opens a small box with the input and a Search
// button (Enter works too). The URL value (`value`) is the truth: the chip re-seeds through the `key` the caller
// sets to that value. The chip's x clears it.
function KeywordChip({
  value,
  placeholder,
  onSubmit,
}: {
  value: string;
  placeholder?: string;
  onSubmit: (keyword: string) => void;
}) {
  const t = useTranslations("list");
  // KeywordFilter commits through setSearchValue AND onSearch: send each keyword to the page once.
  const last = useRef(value);
  const submit = (next: string) => {
    const keyword = next.trim().slice(0, MAX_KEYWORD_LENGTH);
    if (keyword === last.current) return;
    last.current = keyword;
    onSubmit(keyword);
  };

  return (
    <KeywordFilter
      label={t("search")}
      placeholder={placeholder ?? t("searchPlaceholder")}
      searchValue={value}
      // The chip's x (and an empty commit) clear the keyword; a typed value only counts when committed (onSearch).
      setSearchValue={(action) => {
        const next = typeof action === "function" ? action(value) : action;
        if (next === "") submit("");
      }}
      onSearch={(next) => submit(next ?? "")}
    />
  );
}

// The filter row of a list page (doc/07 section 2.5.1): keyword, the page's own filter controls (`children`),
// "Clear filters" when any is active, and `actions` (export …) on the right.
export function FilterBar({
  keyword,
  onKeywordSubmit,
  keywordPlaceholder,
  hideKeyword = false,
  hasActiveFilters,
  onClear,
  actions,
  children,
}: {
  keyword: string;
  onKeywordSubmit: (keyword: string) => void;
  keywordPlaceholder?: string;
  hideKeyword?: boolean;
  hasActiveFilters: boolean;
  onClear: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTranslations("list");

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {hideKeyword ? null : (
        <KeywordChip
          key={keyword}
          value={keyword}
          placeholder={keywordPlaceholder}
          onSubmit={onKeywordSubmit}
        />
      )}
      {children}
      {hasActiveFilters ? (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          <XIcon />
          {t("clearFilters")}
        </Button>
      ) : null}
      {actions ? <div className="flex items-center gap-2 sm:ml-auto">{actions}</div> : null}
    </div>
  );
}
