"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_KEYWORD_LENGTH } from "@/lib/list-params";
import { cn } from "@/lib/utils";

// Keyword box: sent on Enter / the search button (the behaviour `UsersList` always had). The draft text is
// local; the URL value (`value`) re-seeds it through the `key` the caller sets to that value.
function KeywordSearch({
  value,
  placeholder,
  onSubmit,
}: {
  value: string;
  placeholder?: string;
  onSubmit: (keyword: string) => void;
}) {
  const t = useTranslations("list");
  const [draft, setDraft] = useState(value);
  const label = placeholder ?? t("searchPlaceholder");

  return (
    <form
      role="search"
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft.trim());
      }}
    >
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={label}
        aria-label={label}
        maxLength={MAX_KEYWORD_LENGTH}
        className="w-full sm:w-72"
      />
      <Button type="submit" variant="outline">
        <SearchIcon />
        {t("search")}
      </Button>
    </form>
  );
}

// The filter row of a list page (doc/07 section 2.5.1): keyword, the page's own filter controls (`children`),
// "Clear filters" when any is active, and `actions` (export …) on the right.
export function FilterBar({
  keyword,
  onKeywordSubmit,
  keywordPlaceholder,
  hideKeyword = false,
  alignEnd = false,
  hasActiveFilters,
  onClear,
  actions,
  children,
}: {
  keyword: string;
  onKeywordSubmit: (keyword: string) => void;
  keywordPlaceholder?: string;
  hideKeyword?: boolean;
  // Filters with a label ABOVE the control make the filter group taller than the keyword box: align the row to
  // the bottom so the box, its button and the controls share one baseline (default: centred, for chip filters).
  alignEnd?: boolean;
  hasActiveFilters: boolean;
  onClear: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTranslations("list");

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap", alignEnd ? "sm:items-end" : "sm:items-center")}>
      {hideKeyword ? null : (
        <KeywordSearch
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
