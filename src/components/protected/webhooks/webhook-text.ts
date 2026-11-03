"use client";

import { useTranslations } from "next-intl";

import { isKnownErrorClass } from "@/lib/webhooks";
import type { WebhookDeliveryEvent, WebhookDeliveryStatus } from "@/types/webhooks";

const EVENT_KEYS: Record<WebhookDeliveryEvent, string> = {
  "content.published": "contentPublished",
  "content.unpublished": "contentUnpublished",
  "form.submitted": "formSubmitted",
  "media.ready": "mediaReady",
  "user.created": "userCreated",
  "webhook.test": "webhookTest",
};

// Human words for the machine values the screen shows. Every server string is rendered as plain text by React; unknown values fall back to
// a neutral sentence, never to HTML.
export function useWebhookText() {
  const t = useTranslations("webhooks");
  return {
    event: (event: string) => (event in EVENT_KEYS ? t(`events.${EVENT_KEYS[event as WebhookDeliveryEvent]}`) : event),
    eventHint: (event: string) => (event in EVENT_KEYS ? t(`eventHints.${EVENT_KEYS[event as WebhookDeliveryEvent]}`) : ""),
    status: (status: WebhookDeliveryStatus | string) => (["pending", "delivering", "succeeded", "failed", "dead"].includes(status) ? t(`deliveryStatus.${status}`) : status),
    errorClass: (cls: string | null | undefined) => (!cls ? "" : isKnownErrorClass(cls) ? t(`errorClass.${cls}`) : t("errorClass.other")),
  };
}
