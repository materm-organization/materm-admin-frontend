"use client";

import { ErrorState } from "@/components/global/states/error-state";

// Catches an unexpected render exception inside the protected shell (the sidebar and header stay): shows the
// standard error state; "Retry" re-renders the segment. (A failed API read is NOT an exception — pages render
// `ErrorState` / `NoPermission` themselves.)
export default function RoutesError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorState error={error} onRetry={reset} />;
}
