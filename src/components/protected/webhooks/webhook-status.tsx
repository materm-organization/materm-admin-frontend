"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { Webhook } from "@/types/webhooks";

// Active / switched off / switched off by the system after 24 hours of failures. The reason is a machine value: the words are ours.
export function WebhookStatusBadge({ webhook }: { webhook: Pick<Webhook, "is_active" | "disabled_reason"> }) {
  const t = useTranslations("webhooks");
  if (webhook.disabled_reason === "auto_24h_failure")
    return (
      <Badge variant="destructive" className="h-auto max-w-44 justify-start rounded-md px-2 py-1 text-left leading-snug whitespace-normal" data-testid="webhook-status" data-state="auto_disabled">
        {t("autoDisabled")}
      </Badge>
    );
  return webhook.is_active ? (
    <Badge variant="secondary" data-testid="webhook-status" data-state="active">
      {t("active")}
    </Badge>
  ) : (
    <Badge variant="outline" data-testid="webhook-status" data-state="inactive">
      {t("inactive")}
    </Badge>
  );
}
