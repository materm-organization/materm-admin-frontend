"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { Spinner } from "@/components/ui/spinner";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PaginationMetaData = {
  page: number;
  limit: number;
  totalPages: number;
  totalRows: number;
};

// Shows every page if there are 5 or fewer, otherwise the first/last page
// plus a sliding window of 3 around the current page, with "..." markers
// for the gaps.
function generatePageNumbers(page: number, totalPages: number): (number | "...")[] {
  const maxPagesToShow = 5;
  const pages: (number | "...")[] = [];

  if (totalPages <= 0) return pages;

  if (totalPages <= maxPagesToShow) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
    return pages;
  }

  const leftEllipsis = page > 3;
  const rightEllipsis = page < totalPages - 2;

  if (leftEllipsis && rightEllipsis) {
    pages.push(1, "...");
    for (let i = page - 1; i <= page + 1; i++) pages.push(i);
    pages.push("...", totalPages);
  } else if (leftEllipsis) {
    pages.push(1, "...");
    for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
  } else if (rightEllipsis) {
    for (let i = 1; i <= 4; i++) pages.push(i);
    pages.push("...", totalPages);
  }

  return pages;
}

// Shared list-pagination control. `isLoading` here means the query's
// `isFetching` — a background refetch disables the controls without
// blanking the table back to skeletons.
//
// Numbered pages + ellipsis via shadcn's `Pagination` primitive family,
// with icon-only prev/next (the generated `ui/pagination.tsx` primitive's
// text labels are hardcoded English, which would regress i18n) and
// disabled states on the page links.
export function CustomPagination({
  metaData,
  onPageChange,
  isLoading,
}: {
  metaData: PaginationMetaData | undefined;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
}) {
  const t = useTranslations("common");
  const page = metaData?.page ?? 1;
  const totalPages = metaData?.totalPages ?? 1;
  const [pendingPage, setPendingPage] = useState<number | null>(null);

  const handlePageChange = (nextPage: number) => {
    if (nextPage === page || nextPage < 1 || nextPage > totalPages) return;
    setPendingPage(nextPage);
    onPageChange(nextPage);
  };

  const pageNumbers = generatePageNumbers(page, totalPages);

  return (
    <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
      <p className="text-sm text-muted-foreground">
        {metaData ? t("rowsCount", { count: metaData.totalRows }) : null}
      </p>

      {totalPages > 1 ? (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent className="flex items-center gap-1">
            <PaginationItem>
              <PaginationLink
                aria-label="previous"
                aria-disabled={isLoading || page <= 1}
                className={cn(
                  "cursor-pointer",
                  (isLoading || page <= 1) && "pointer-events-none opacity-50"
                )}
                onClick={() => handlePageChange(page - 1)}
              >
                <ChevronLeftIcon className="size-4" />
              </PaginationLink>
            </PaginationItem>

            {pageNumbers.map((pageNumber, index) =>
              pageNumber === "..." ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={pageNumber}>
                  <PaginationLink
                    isActive={pageNumber === page}
                    aria-disabled={isLoading}
                    className={cn(
                      "w-auto min-w-9 cursor-pointer px-2 tabular-nums",
                      isLoading && "pointer-events-none"
                    )}
                    onClick={() => handlePageChange(pageNumber)}
                  >
                    {isLoading && pageNumber === pendingPage ? <Spinner className="size-4" /> : pageNumber}
                  </PaginationLink>
                </PaginationItem>
              )
            )}

            <PaginationItem>
              <PaginationLink
                aria-label="next"
                aria-disabled={isLoading || page >= totalPages}
                className={cn(
                  "cursor-pointer",
                  (isLoading || page >= totalPages) && "pointer-events-none opacity-50"
                )}
                onClick={() => handlePageChange(page + 1)}
              >
                <ChevronRightIcon className="size-4" />
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
}
