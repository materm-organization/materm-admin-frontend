"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { usageHref } from "@/lib/media";
import type { MediaUsage } from "@/types/media";

type UsageRow = Pick<MediaUsage, "entity_type" | "id" | "title" | "field"> & Partial<Pick<MediaUsage, "status" | "in_draft_only">>;

// "JSON Pointer inside the owner" (`/sections/<uuid>/props/background/media_id`) as a short readable hint: the
// last two meaningful segments (`background / media_id`), never the section's uuid.
export function usageFieldHint(field: string): string {
  const parts = field.split("/").filter(Boolean);
  const clean = parts.filter((p, i) => !(parts[i - 1] === "sections" && /^[0-9a-f-]{16,}$/i.test(p)));
  return clean.slice(-3).join(" / ");
}

// Where a media row is used (doc/07 section 3.22 "ใช้ที่": links to the editor of the owner). Used by the detail
// sheet and by the "cannot delete, it is in use" dialog. Owners whose editor is not part of the admin yet are
// shown as plain text.
export function UsageList({ usages, label }: { usages: readonly UsageRow[]; label?: string }) {
  const t = useTranslations("media.usage");
  return (
    <ul className="divide-y rounded-md border text-sm" aria-label={label ?? t("title")}>
      {usages.map((usage, index) => {
        const href = usageHref(usage);
        const typeLabel = t.has(`types.${usage.entity_type.replace(/\./g, "_")}`)
          ? t(`types.${usage.entity_type.replace(/\./g, "_")}`)
          : usage.entity_type;
        const name = usage.title || `#${usage.id}`;
        return (
          <li key={`${usage.entity_type}:${usage.id}:${usage.field}:${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <Badge variant="secondary">{typeLabel}</Badge>
            {href ? (
              <Link href={href} prefetch={false} className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
                {name}
                <ExternalLinkIcon className="size-3" aria-hidden />
              </Link>
            ) : (
              <span className="font-medium">{name}</span>
            )}
            <span className="text-xs text-muted-foreground">{usageFieldHint(usage.field)}</span>
            {usage.in_draft_only ? <Badge variant="outline">{t("draftOnly")}</Badge> : null}
            {usage.status ? <span className="ml-auto text-xs text-muted-foreground">{usage.status}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
