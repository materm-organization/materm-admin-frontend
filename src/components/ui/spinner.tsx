import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

// The one loading spinner for the whole app — `animate-spin` is baked in
// here, never re-added to a raw icon ad hoc at the call site (architecture
// doc §13).
export function Spinner({ className, ...props }: React.ComponentProps<typeof Loader2Icon>) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}
