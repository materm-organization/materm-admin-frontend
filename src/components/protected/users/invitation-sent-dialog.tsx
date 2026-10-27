"use client";

import { MailCheckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { CreatedUserResult } from "@/components/protected/users/create-user-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Result of `POST /users` with `delivery: invite`: who was invited, until when the link works and how the
// e-mail went (`email_delivery`): `queued` = handed to the mailer; `logged_only` = this server has no mailer (dev)
// and the link was only written to the server log; `null` = unknown (older server). Nothing secret is shown here
// (the link is never returned by the API).
export function InvitationSentDialog({ result, onDone }: { result: CreatedUserResult; onDone: () => void }) {
  const t = useTranslations("users.invitationSent");
  const format = useFormatter();
  const expires = result.invitationExpiresAt
    ? format.dateTime(new Date(result.invitationExpiresAt), { dateStyle: "medium", timeStyle: "short" })
    : "—";
  const status = result.emailDelivery ?? "unknown";

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onDone())}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailCheckIcon className="size-5" aria-hidden />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description", { name: result.name, email: result.email ?? "—", expires })}</DialogDescription>
        </DialogHeader>
        <p
          role="status"
          className={
            status === "logged_only"
              ? "rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
              : "rounded-md border bg-muted/40 p-3 text-sm"
          }
        >
          {t(`delivery.${status}`)}
        </p>
        <DialogFooter>
          <Button type="button" onClick={onDone}>
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
