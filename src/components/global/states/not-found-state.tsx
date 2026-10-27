"use client";

import { FileQuestionIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { Button } from "@/components/ui/button";

// "Not found": a route nobody registered (the guard's `unknown` kind), a 404 `NOT_FOUND` from a GET of one
// item, or Next's `notFound()` inside the protected shell. Defaults are the page-level wording; a detail page
// passes its own title and the list it can go back to.
export function NotFoundState({
  title,
  description,
  backHref = "/admin",
  backLabel,
}: {
  title?: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
}) {
  const t = useTranslations("states.notFound");

  return (
    <div
      role="alert"
      className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center"
    >
      <FileQuestionIcon className="size-6 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title ?? t("title")}</p>
        <p className="text-sm text-muted-foreground">{description ?? t("description")}</p>
      </div>
      <Button asChild variant="outline">
        <Link href={backHref}>{backLabel ?? t("back")}</Link>
      </Button>
    </div>
  );
}
