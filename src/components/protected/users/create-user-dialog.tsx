"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailPlusIcon, UserPlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useAssignableRoles } from "@/components/protected/users/use-assignable-roles";
import { useMutationCreateUser } from "@/hooks/use-users";

const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{3,64}$/;

export type CreateDelivery = "temporary_password" | "invite";

// One schema for both modes. `temporary_password`: username required, e-mail optional. `invite` (doc/05
// section 3.1.2): e-mail required, NO username (the invitee picks it when accepting).
function createUserSchema(t: (key: string) => string, delivery: CreateDelivery) {
  return z
    .object({
      name: z.string().trim().min(1, t("validation.nameRequired")).max(120, t("validation.nameTooLong")),
      username: z.string().trim(),
      // "" = not provided.
      email: z.union([
        z.literal(""),
        z.string().trim().email(t("validation.emailInvalid")).max(254, t("validation.emailTooLong")),
      ]),
      role_id: z.string().min(1, t("validation.roleRequired")),
    })
    .superRefine((v, ctx) => {
      if (delivery === "temporary_password" && !USERNAME_PATTERN.test(v.username)) {
        ctx.addIssue({ code: "custom", path: ["username"], message: t("validation.usernameInvalid") });
      }
      if (delivery === "invite" && v.email === "") {
        ctx.addIssue({ code: "custom", path: ["email"], message: t("validation.emailRequired") });
      }
    });
}

type CreateUserFormValues = {
  name: string;
  username: string;
  email: string;
  role_id: string;
};

export type CreatedUserResult = {
  delivery: CreateDelivery;
  name: string;
  username: string;
  email: string | null;
  temporaryPassword: string | null;
  invitationExpiresAt: string | null;
  emailDelivery: "queued" | "logged_only" | null;
};

// Creates a user in one of two modes (a switch at the top; the list page opens the dialog in the mode of the
// button that was pressed):
//  - `invite` (P1): e-mail required, no password and no username; the invitee gets a link (72 h) and chooses
//    both. The answer says how the e-mail went (`email_delivery`: queued / logged_only).
//  - `temporary_password`: username required; the one-time password goes to `onCreated` and is shown once.
// Each mode has its OWN Idempotency-Key per dialog open: switching mode (a different body) starts a new key, a
// double click or a retry in the same mode replays the same one. The form field names equal the API field names,
// so server `errors[]` land on the right input.
export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
  initialDelivery = "temporary_password",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: CreatedUserResult) => void;
  initialDelivery?: CreateDelivery;
}) {
  const t = useTranslations("users.create");
  const mutation = useMutationCreateUser();
  const roles = useAssignableRoles(open);
  const { handleFormError } = useApiErrorHandler();
  // The mode the dialog was last opened in; changed by the switch. Re-seeded each time it opens.
  const [state, setState] = useState<{ open: boolean; delivery: CreateDelivery }>({
    open,
    delivery: initialDelivery,
  });
  if (state.open !== open) setState({ open, delivery: open ? initialDelivery : state.delivery });
  const delivery = state.delivery;
  const isInvite = delivery === "invite";
  // One key per open AND per mode: a different mode is a different request body (IDEMPOTENCY_KEY_REUSED otherwise).
  const keyTemporary = useIdempotencyKey(open && delivery === "temporary_password");
  const keyInvite = useIdempotencyKey(open && delivery === "invite");
  const idempotencyKey = isInvite ? keyInvite : keyTemporary;

  const form = useForm<CreateUserFormValues>({
    // Rebuilt every render (react-hook-form reads `resolver` from the latest options), so it follows the mode.
    resolver: zodResolver(createUserSchema(t, delivery)),
    defaultValues: { name: "", username: "", email: "", role_id: "" },
  });

  const handleOpenChange = (next: boolean) => {
    if (mutation.isPending) return;
    if (!next) form.reset();
    onOpenChange(next);
  };

  const changeDelivery = (next: CreateDelivery) => {
    if (next === delivery || mutation.isPending) return;
    setState({ open, delivery: next });
    form.clearErrors();
  };

  const onSubmit = (values: CreateUserFormValues) => {
    mutation.mutate(
      {
        payload: {
          name: values.name,
          role_id: Number(values.role_id),
          delivery,
          ...(isInvite ? {} : { username: values.username }),
          ...(values.email ? { email: values.email } : {}),
        },
        idempotencyKey,
      },
      {
        onSuccess: (res) => {
          const result: CreatedUserResult = {
            delivery,
            name: res.data.user.name,
            username: res.data.user.username,
            email: res.data.user.email,
            temporaryPassword: res.data.temporary_password,
            invitationExpiresAt: res.data.invitation_expires_at,
            emailDelivery: res.data.email_delivery ?? null,
          };
          // Drop the response (it holds the password) from the mutation state.
          mutation.reset();
          form.reset();
          onOpenChange(false);
          toast.success(isInvite ? t("toast.invited") : t("toast.success"));
          onCreated(result);
        },
        // 422/409 `errors[]` -> on the matching input; 403 SUPER_ADMIN_PROTECTED, 429, 503 (no mailer), 5xx ->
        // global toast.
        onError: (error) => handleFormError(form, error, { fallback: t("toast.error") }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isInvite ? <MailPlusIcon className="size-5" /> : <UserPlusIcon className="size-5" />}
            {isInvite ? t("titleInvite") : t("title")}
          </DialogTitle>
          <DialogDescription>{isInvite ? t("descriptionInvite") : t("description")}</DialogDescription>
        </DialogHeader>
        <Tabs value={delivery} onValueChange={(v) => changeDelivery(v as CreateDelivery)}>
          <TabsList className="w-full" aria-label={t("modes.label")}>
            <TabsTrigger value="invite" disabled={mutation.isPending}>
              {t("modes.invite")}
            </TabsTrigger>
            <TabsTrigger value="temporary_password" disabled={mutation.isPending}>
              {t("modes.temporary")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("fields.name")} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input autoComplete="off" disabled={mutation.isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isInvite ? null : (
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("fields.username")} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="off"
                        placeholder={t("fields.usernamePlaceholder")}
                        disabled={mutation.isPending}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {isInvite ? t("fields.emailRequired") : t("fields.email")}
                    {isInvite ? <span className="text-destructive"> *</span> : null}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="off"
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("fields.role")} <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={mutation.isPending || roles.isLoading}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("fields.rolePlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {roles.assignable.map((role) => (
                        <SelectItem key={role.id} value={String(role.id)}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-xs text-muted-foreground">{isInvite ? t("inviteNote") : t("passwordNote")}</p>
            <DialogFooter className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button
                  disabled={mutation.isPending}
                  type="button"
                  variant="outline"
                  className="w-full md:w-auto"
                >
                  {t("buttons.cancel")}
                </Button>
              </DialogClose>
              <Button disabled={mutation.isPending} type="submit" className="w-full md:w-auto">
                {mutation.isPending ? <Spinner /> : null}
                {isInvite ? t("buttons.invite") : t("buttons.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
