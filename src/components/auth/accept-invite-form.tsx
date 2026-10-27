"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserCheckIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { InvalidLinkCard } from "@/components/auth/invalid-link-card";
import { PasswordPolicyChecklist } from "@/components/auth/password-policy-checklist";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationAcceptInvitation, useMutationVerifyInvitation } from "@/hooks/use-auth";
import { useFragmentToken } from "@/hooks/use-fragment-token";
import { API_ERROR_CODES, parseApiError } from "@/lib/api-error";
import { SIGN_IN_PATH, getAccessToken } from "@/lib/auth-session";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, codePointLength } from "@/lib/password-policy";
import type { InvitationVerifyResult } from "@/types/user";

const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{3,64}$/;

function createSchema(t: (key: string) => string) {
  return z
    .object({
      username: z.string().trim().regex(USERNAME_PATTERN, t("validation.usernameInvalid")),
      name: z
        .string()
        .trim()
        .refine((v) => [...v].length >= 1, t("validation.nameRequired"))
        .refine((v) => [...v].length <= 120, t("validation.nameTooLong")),
      password: z
        .string()
        .refine((v) => codePointLength(v) >= PASSWORD_MIN_LENGTH, t("validation.passwordTooShort"))
        .refine((v) => codePointLength(v) <= PASSWORD_MAX_LENGTH, t("validation.passwordTooLong")),
      confirmPassword: z.string().min(1, t("validation.confirmRequired")),
    })
    .refine((v) => v.password === v.confirmPassword, {
      message: t("validation.mismatch"),
      path: ["confirmPassword"],
    });
}
type Values = z.infer<ReturnType<typeof createSchema>>;

// SCR-04. The token comes from the URL fragment (removed from the address bar at once) and is sent only in the
// POST bodies. First `verify` (no state change, repeatable): name / e-mail / role / expiry are shown and the
// username is pre-filled with `suggested_username`. Then `accept` with username + password (+ the name if it was
// edited): the answer is a TokenPair -> stored like a sign-in -> `/admin`. A browser that is still signed in as
// somebody else is told so, and that old session is ended when the invitation is accepted.
export function AcceptInviteForm() {
  const fragment = useFragmentToken();
  const verify = useMutationVerifyInvitation();
  const verifiedFor = useRef<string | null>(null);
  const [tokenRejected, setTokenRejected] = useState(false);
  const token = fragment.token;
  const verifyMutate = verify.mutate;

  useEffect(() => {
    if (!token || verifiedFor.current === token) return;
    verifiedFor.current = token;
    verifyMutate(token, { onError: (error) => setTokenRejected(parseApiError(error).code === API_ERROR_CODES.INVALID_TOKEN) });
  }, [token, verifyMutate]);

  const t = useTranslations("auth.accept");

  if (fragment.status === "pending" || (fragment.status === "ready" && !verify.isError && !verify.data)) {
    return (
      <div className="flex min-h-40 items-center justify-center" role="status" aria-label={t("loading")}>
        <Spinner className="size-6" />
      </div>
    );
  }

  if (fragment.status === "missing" || tokenRejected) return <InvalidInvitation />;

  if (verify.isError || !verify.data || !token) {
    // Network / 429 / 5xx: already toasted globally. The link is still good, so offer to try again.
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl">{t("loadError.title")}</CardTitle>
          <CardDescription role="alert">{t("loadError.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            variant="outline"
            disabled={verify.isPending}
            onClick={() => token && verify.mutate(token)}
          >
            {verify.isPending ? <Spinner /> : null}
            {t("loadError.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <AcceptForm token={token} invitation={verify.data.data} />;
}

function InvalidInvitation() {
  const t = useTranslations("auth.accept");
  return (
    <InvalidLinkCard
      title={t("invalid.title")}
      description={t("invalid.description")}
      actionHref={SIGN_IN_PATH}
      actionLabel={t("invalid.backToSignIn")}
    />
  );
}

function AcceptForm({ token, invitation }: { token: string; invitation: InvitationVerifyResult }) {
  const t = useTranslations("auth.accept");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const mutation = useMutationAcceptInvitation();
  const { handleFormError } = useApiErrorHandler();
  const [tokenRejected, setTokenRejected] = useState(false);
  const [serverCodes, setServerCodes] = useState<string[]>([]);
  // Read once on mount (a cookie does not exist during the server render).
  const [signedInElsewhere, setSignedInElsewhere] = useState(false);
  useEffect(() => {
    // One-time read of the browser's cookie jar after mount (it does not exist on the server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSignedInElsewhere(!!getAccessToken());
  }, []);

  const form = useForm<Values>({
    resolver: zodResolver(createSchema(t)),
    defaultValues: {
      username: invitation.suggested_username ?? "",
      name: invitation.name,
      password: "",
      confirmPassword: "",
    },
  });
  const [password, username, name] = useWatch({ control: form.control, name: ["password", "username", "name"] });

  if (tokenRejected) return <InvalidInvitation />;

  const onSubmit = (values: Values) => {
    setServerCodes([]);
    mutation.mutate(
      {
        token,
        username: values.username,
        password: values.password,
        ...(values.name !== invitation.name ? { name: values.name } : {}),
      },
      {
        onSuccess: () => router.replace("/admin"),
        onError: (error) => {
          const parsed = parseApiError(error);
          if (parsed.code === API_ERROR_CODES.INVALID_TOKEN) {
            setTokenRejected(true);
            return;
          }
          setServerCodes(parsed.fieldErrors.filter((f) => f.path === "/password").map((f) => f.code));
          // 409 CONFLICT_DUPLICATE: the field is `/username`. If the server sent no `errors[]` for it, still put
          // the message on the username input (a toast alone would leave the user guessing).
          if (
            parsed.status === 409 &&
            parsed.code === API_ERROR_CODES.CONFLICT_DUPLICATE &&
            !parsed.fieldErrors.some((f) => f.path === "/username")
          ) {
            form.setError("username", { type: "server", message: tErrors("fields.duplicate") }, { shouldFocus: true });
            return;
          }
          handleFormError(form, error, { fallback: t("error") });
        },
      }
    );
  };

  const busy = mutation.isPending;
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-3 text-sm">
          <dt className="text-muted-foreground">{t("summary.email")}</dt>
          <dd className="break-all font-medium">{invitation.email}</dd>
          <dt className="text-muted-foreground">{t("summary.role")}</dt>
          <dd className="font-medium">{invitation.role_name}</dd>
          <dt className="text-muted-foreground">{t("summary.expires")}</dt>
          <dd>{format.dateTime(new Date(invitation.expires_at), { dateStyle: "medium", timeStyle: "short" })}</dd>
        </dl>
        {signedInElsewhere ? (
          <p role="note" className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            {t("signedInNote")}
          </p>
        ) : null}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("usernameLabel")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="username" disabled={busy} {...field} />
                  </FormControl>
                  <FormDescription>{t("usernameHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("nameLabel")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" disabled={busy} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("passwordLabel")}</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      disabled={busy}
                      showPasswordLabel={t("showPassword")}
                      hidePasswordLabel={t("hidePassword")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <PasswordPolicyChecklist
              password={password}
              identity={[username, name, invitation.email]}
              serverCodes={serverCodes}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("confirmLabel")}</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" disabled={busy} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : <UserCheckIcon />}
              {busy ? t("submitting") : t("submit")}
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href={SIGN_IN_PATH}>{t("backToSignIn")}</Link>
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
