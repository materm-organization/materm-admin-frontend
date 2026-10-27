import { Skeleton } from "@/components/ui/skeleton";

// "Loading" for a detail/editor page: a header line and three cards. No full-screen spinner for list/detail
// pages (spinners are only for the guard and for buttons).
export function EditorSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-9 w-28" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full" />
      ))}
    </div>
  );
}
