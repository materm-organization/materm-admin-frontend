"use client";

import {
  KeyRoundIcon,
  LockOpenIcon,
  LogOutIcon,
  MailPlusIcon,
  MoreHorizontalIcon,
  ShieldAlertIcon,
  Trash2Icon,
  UserCheckIcon,
  UserXIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { OneTimeSecretDialog } from "@/components/global/one-time-secret-dialog";
import { useCan } from "@/hooks/use-permission";
import { useAssignableRoles } from "@/components/protected/users/use-assignable-roles";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import {
  useMutationDeleteUser,
  useMutationForcePasswordChange,
  useMutationResendInvitation,
  useMutationResetPassword,
  useMutationRevokeSessions,
  useMutationUserCommand,
} from "@/hooks/use-users";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ResetPasswordDelivery, User } from "@/types/iam";

type Pending = "activate" | "deactivate" | "unlock" | "delete" | "revoke" | "force" | "reset" | null;

// SCR-08 commands (doc/07 section 3.4), shown by the user's state and the signed-in user's grants:
//   invited  -> resend invitation;  disabled -> activate;  active / locked -> deactivate (+ unlock when locked);
//   not invited -> reset password, force a password change, revoke sessions;  delete.
// On your own account deactivate / delete / reset are hidden (409 SELF_ACTION_NOT_ALLOWED). Activate, deactivate,
// unlock and delete ask for confirmation. The P1 commands (reset, force, revoke, resend) are wired to their
// endpoints; if the backend does not have one yet the normal error handling shows the server's answer.
export function UserCommands({ user }: { user: User }) {
  const t = useTranslations("users.commands");
  const tt = useTranslations("users.temporaryPassword");
  const format = useFormatter();
  const router = useRouter();
  const { toastError } = useApiErrorHandler();
  const { meId } = useAssignableRoles();
  const canUpdate = useCan(PERMISSION_KEYS.IAM_USERS, PERMISSION_ACTIONS.UPDATE);
  const canCreate = useCan(PERMISSION_KEYS.IAM_USERS, PERMISSION_ACTIONS.CREATE);
  const canDelete = useCan(PERMISSION_KEYS.IAM_USERS, PERMISSION_ACTIONS.DELETE);

  const command = useMutationUserCommand(user.id);
  const del = useMutationDeleteUser();
  const revoke = useMutationRevokeSessions(user.id);
  const force = useMutationForcePasswordChange(user.id);
  const resend = useMutationResendInvitation(user.id);
  const reset = useMutationResetPassword(user.id);

  const [pending, setPending] = useState<Pending>(null);
  const [forceRevoke, setForceRevoke] = useState(false);
  const [delivery, setDelivery] = useState<ResetPasswordDelivery>(user.email ? "email" : "temporary_password");
  // The one-time temporary password lives ONLY here until "Done" — never in the query cache or storage.
  const [issued, setIssued] = useState<string | null | undefined>(undefined);
  const idempotencyKey = useIdempotencyKey(pending === "reset");

  const isSelf = meId === user.id;
  const invited = user.state === "invited";
  const canDeactivate = canUpdate && !isSelf && !invited && user.status;
  const canActivate = canUpdate && !invited && !user.status;
  const canUnlock = canUpdate && user.state === "locked";
  const canSecurity = canUpdate && !invited;
  const canReset = canSecurity && !isSelf;
  const canResend = canCreate && invited;
  const canRemove = canDelete && !isSelf;
  const any = canDeactivate || canActivate || canUnlock || canSecurity || canResend || canRemove;
  if (!any) return null;

  // Confirmed command that answers with a plain toast. Errors toast through the normal path and keep the dialog.
  const run = async (action: () => Promise<unknown>, success: string, fallback: string) => {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toastError(error, fallback);
      throw error;
    }
  };

  const submitReset = () => {
    reset.mutate(
      { delivery, idempotencyKey },
      {
        onSuccess: (res) => {
          const secret = res.data.temporary_password;
          reset.reset();
          setPending(null);
          if (res.data.delivery === "temporary_password") {
            setIssued(secret);
          } else if (res.data.email_delivery === "logged_only") {
            toast.warning(t("reset.toast.loggedOnly", { sessions: res.data.revoked_sessions }));
          } else {
            toast.success(
              res.data.link_expires_at
                ? t("reset.toast.linkSent", {
                    expires: format.dateTime(new Date(res.data.link_expires_at), { dateStyle: "medium", timeStyle: "short" }),
                    sessions: res.data.revoked_sessions,
                  })
                : t("reset.toast.linkSentNoExpiry", { sessions: res.data.revoked_sessions })
            );
          }
        },
        onError: (error) => toastError(error, t("reset.toast.error")),
      }
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline">
            <MoreHorizontalIcon />
            {t("menu")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {canResend ? (
            <DropdownMenuItem
              onSelect={() =>
                resend.mutate(undefined, {
                  onSuccess: (res) =>
                    res.data.email_delivery === "logged_only"
                      ? toast.warning(t("resend.toast.loggedOnly"))
                      : toast.success(
                          t("resend.toast.success", {
                            expires: format.dateTime(new Date(res.data.invitation_expires_at), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }),
                          })
                        ),
                  onError: (error) => toastError(error, t("resend.toast.error")),
                })
              }
            >
              <MailPlusIcon /> {t("resend.item")}
            </DropdownMenuItem>
          ) : null}
          {canUnlock ? (
            <DropdownMenuItem onSelect={() => setPending("unlock")}>
              <LockOpenIcon /> {t("unlock.item")}
            </DropdownMenuItem>
          ) : null}
          {canActivate ? (
            <DropdownMenuItem onSelect={() => setPending("activate")}>
              <UserCheckIcon /> {t("activate.item")}
            </DropdownMenuItem>
          ) : null}
          {canReset ? (
            <DropdownMenuItem onSelect={() => setPending("reset")}>
              <KeyRoundIcon /> {t("reset.item")}
            </DropdownMenuItem>
          ) : null}
          {canSecurity ? (
            <DropdownMenuItem onSelect={() => setPending("force")}>
              <ShieldAlertIcon /> {t("force.item")}
            </DropdownMenuItem>
          ) : null}
          {canSecurity ? (
            <DropdownMenuItem onSelect={() => setPending("revoke")}>
              <LogOutIcon /> {t("revoke.item")}
            </DropdownMenuItem>
          ) : null}
          {canDeactivate || canRemove ? <DropdownMenuSeparator /> : null}
          {canDeactivate ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setPending("deactivate")}>
              <UserXIcon /> {t("deactivate.item")}
            </DropdownMenuItem>
          ) : null}
          {canRemove ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setPending("delete")}>
              <Trash2Icon /> {t("delete.item")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={pending === "activate"}
        onOpenChange={(o) => !o && setPending(null)}
        title={t("activate.title", { name: user.name })}
        description={t("activate.description")}
        confirmLabel={t("activate.confirm")}
        onConfirm={() => run(() => command.mutateAsync("activate"), t("activate.toast.success"), t("activate.toast.error"))}
      />
      <ConfirmDialog
        open={pending === "deactivate"}
        onOpenChange={(o) => !o && setPending(null)}
        title={t("deactivate.title", { name: user.name })}
        description={t("deactivate.description")}
        confirmLabel={t("deactivate.confirm")}
        destructive
        onConfirm={() =>
          run(() => command.mutateAsync("deactivate"), t("deactivate.toast.success"), t("deactivate.toast.error"))
        }
      />
      <ConfirmDialog
        open={pending === "unlock"}
        onOpenChange={(o) => !o && setPending(null)}
        title={t("unlock.title", { name: user.name })}
        description={t("unlock.description")}
        confirmLabel={t("unlock.confirm")}
        onConfirm={() => run(() => command.mutateAsync("unlock"), t("unlock.toast.success"), t("unlock.toast.error"))}
      />
      <ConfirmDialog
        open={pending === "delete"}
        onOpenChange={(o) => !o && setPending(null)}
        title={t("delete.title", { name: user.name })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        destructive
        onConfirm={async () => {
          await run(() => del.mutateAsync(user.id), t("delete.toast.success"), t("delete.toast.error"));
          router.push("/admin/users");
        }}
      />
      <ConfirmDialog
        open={pending === "revoke"}
        onOpenChange={(o) => !o && setPending(null)}
        title={t("revoke.title", { name: user.name })}
        description={t("revoke.description")}
        confirmLabel={t("revoke.confirm")}
        destructive
        onConfirm={async () => {
          try {
            const res = await revoke.mutateAsync();
            toast.success(t("revoke.toast.success", { count: res.data.revoked_sessions }));
          } catch (error) {
            toastError(error, t("revoke.toast.error"));
            throw error;
          }
        }}
      />

      <Dialog open={pending === "force"} onOpenChange={(o) => !o && !force.isPending && setPending(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("force.title", { name: user.name })}</DialogTitle>
            <DialogDescription>{t("force.description")}</DialogDescription>
          </DialogHeader>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox checked={forceRevoke} onCheckedChange={(c) => setForceRevoke(c === true)} />
            {t("force.revokeSessions")}
          </Label>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={force.isPending} onClick={() => setPending(null)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              disabled={force.isPending}
              onClick={() =>
                force.mutate(forceRevoke, {
                  onSuccess: () => {
                    toast.success(t("force.toast.success"));
                    setPending(null);
                  },
                  onError: (error) => toastError(error, t("force.toast.error")),
                })
              }
            >
              {force.isPending ? <Spinner /> : null}
              {t("force.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pending === "reset"} onOpenChange={(o) => !o && !reset.isPending && setPending(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("reset.title", { name: user.name })}</DialogTitle>
            <DialogDescription>{t("reset.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{t("reset.delivery")}</Label>
            <Select value={delivery} onValueChange={(v) => setDelivery(v as ResetPasswordDelivery)}>
              <SelectTrigger className="w-full" aria-label={t("reset.delivery")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email" disabled={!user.email}>
                  {t("reset.byEmail")}
                </SelectItem>
                <SelectItem value="temporary_password">{t("reset.byTemporary")}</SelectItem>
              </SelectContent>
            </Select>
            {!user.email ? <p className="text-xs text-muted-foreground">{t("reset.noEmail")}</p> : null}
            <p className="text-xs text-muted-foreground">{t("reset.signsOut")}</p>
          </div>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={reset.isPending} onClick={() => setPending(null)}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={reset.isPending} onClick={submitReset}>
              {reset.isPending ? <Spinner /> : null}
              {t("reset.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {issued !== undefined ? (
        <OneTimeSecretDialog
          secret={issued}
          onDone={() => setIssued(undefined)}
          title={tt("title")}
          description={t("reset.secretDescription", { username: user.username })}
          label={tt("label")}
          onceWarning={tt("onceWarning")}
          unavailable={tt("unavailable")}
          doneLabel={tt("done")}
        />
      ) : null}
    </>
  );
}
