"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { useWebhookText } from "@/components/protected/webhooks/webhook-text";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { WEBHOOK_EVENTS, sortEvents } from "@/lib/webhooks";
import type { WebhookEvent } from "@/types/webhooks";

// The five events a webhook can subscribe to, as a checkbox group with a human label and one line of what it sends.
export function WebhookEventsField({
  value,
  onChange,
  disabled,
  error,
}: {
  value: WebhookEvent[];
  onChange: (next: WebhookEvent[]) => void;
  disabled?: boolean;
  error?: string;
}) {
  const t = useTranslations("webhooks.dialog");
  const text = useWebhookText();
  const id = useId();
  const toggle = (event: WebhookEvent, on: boolean) => onChange(sortEvents(on ? [...value, event] : value.filter((e) => e !== event)));
  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={`${id}-help`} data-testid="webhook-events">
      <legend className="text-sm font-medium leading-snug">
        {t("events")}
        <span aria-hidden className="ml-0.5 text-destructive">*</span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {WEBHOOK_EVENTS.map((event) => (
          <div key={event} className="flex items-start gap-2 rounded-md border p-2.5">
            <Checkbox
              id={`${id}-${event}`}
              checked={value.includes(event)}
              disabled={disabled}
              aria-invalid={Boolean(error)}
              onCheckedChange={(checked) => toggle(event, checked === true)}
              className="mt-0.5"
            />
            <Label htmlFor={`${id}-${event}`} className="flex-col items-start gap-0.5 font-normal leading-snug">
              <span className="font-medium">{text.event(event)}</span>
              <span className="text-xs text-muted-foreground">{text.eventHint(event)}</span>
            </Label>
          </div>
        ))}
      </div>
      {error ? (
        <p id={`${id}-help`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {t("eventsHelp")}
        </p>
      )}
    </fieldset>
  );
}
