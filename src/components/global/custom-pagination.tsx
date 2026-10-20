"use client";

import { Loader2 } from "lucide-react";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import type { ApiMeta } from "@/types/api";

// Numbered-page pagination control — ported verbatim from the reference
// project's components/global/custom-pagination.tsx. Replaces the earlier
// prev/next-only `pagination.tsx` as the one pagination component every
// feature's tabs-content.tsx embeds in its table's TableFooter row.
interface PaginationProps {
  metaData: ApiMeta;
  onPageChange: (page: number) => void;
  isLoading: boolean;
  rowLimit: number;
  setRowLimit: (limit: number) => void;
}

export function CustomPagination({ metaData, onPageChange, isLoading }: PaginationProps) {
  const { page, total_page: totalPages } = metaData;

  const generatePageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxPagesToShow = 5;

    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
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
    }

    return pages;
  };

  if (!metaData || metaData.total_page <= 1) return <div />;

  return (
    <div className="flex flex-col items-center justify-between space-y-2 border-gray-200 p-2 md:flex-row md:space-y-0">
      <div>
        <Pagination>
          <PaginationContent className="flex items-center gap-1">
            <PaginationItem className="cursor-pointer">
              <PaginationPrevious onClick={() => onPageChange(Math.max(1, page - 1))} />
            </PaginationItem>

            {generatePageNumbers().map((pageNumber, index) => (
              <PaginationItem key={index} className="cursor-pointer">
                {pageNumber === "..." ? (
                  <PaginationEllipsis />
                ) : (
                  <PaginationLink
                    isActive={pageNumber === page}
                    onClick={() => onPageChange(pageNumber as number)}
                    className="w-auto min-w-9 px-2 tabular-nums"
                  >
                    {isLoading && pageNumber === page + 1 ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      pageNumber
                    )}
                  </PaginationLink>
                )}
              </PaginationItem>
            ))}

            <PaginationItem className="cursor-pointer">
              <PaginationNext onClick={() => onPageChange(Math.min(totalPages, page + 1))} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
