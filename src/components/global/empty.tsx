import { InboxIcon } from "lucide-react";

// The one shared empty-state component — every
// feature's "no rows" case reuses this instead of inventing its own markup.
export function EmptyMuted({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
      <InboxIcon className="size-5" />
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="text-xs">{description}</p> : null}
    </div>
  );
}
