"use client";

import { CheckIcon, CircleIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { evaluatePassword } from "@/lib/password-policy";
import { cn } from "@/lib/utils";

type Row = { id: string; label: string; state: "ok" | "fail" | "pending" };

// Live checklist under a "new password" field. Rows that need the server (common passwords, recent passwords)
// stay "pending" until the server answers; a `password_policy.*` code it returned turns the matching row red
// (`serverCodes` = the field codes of the 422 for `/new_password`). `identity` = what the password must not
// equal (username, name, e-mail) where the screen knows it.
export function PasswordPolicyChecklist({
  password,
  identity,
  serverCodes = [],
  showReused = false,
}: {
  password: string;
  identity?: (string | null | undefined)[];
  serverCodes?: string[];
  showReused?: boolean;
}) {
  const t = useTranslations("auth.passwordPolicy");
  const checks = evaluatePassword(password, identity);
  const typed = password.length > 0;

  const fromServer = (code: string) => serverCodes.includes(`password_policy.${code}`);
  const live = (ok: boolean | null, code: string): Row["state"] =>
    fromServer(code) ? "fail" : ok === null || !typed ? "pending" : ok ? "ok" : "fail";

  const rows: Row[] = [
    { id: "min", label: t("minLength"), state: live(checks.minLength, "min_length") },
    ...(identity && identity.length > 0
      ? [{ id: "identity", label: t("notIdentity"), state: live(checks.notIdentity, "contains_identity") }]
      : []),
    { id: "common", label: t("notCommon"), state: fromServer("common") ? "fail" : "pending" },
    ...(showReused
      ? [{ id: "reused", label: t("notReused"), state: fromServer("reused") ? ("fail" as const) : ("pending" as const) }]
      : []),
  ];

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{t("title")}</p>
      <ul className="space-y-1" aria-live="polite">
        {rows.map((row) => (
          <li
            key={row.id}
            data-state={row.state}
            className={cn(
              "flex items-center gap-2 text-xs",
              row.state === "ok" && "text-emerald-600 dark:text-emerald-400",
              row.state === "fail" && "text-destructive",
              row.state === "pending" && "text-muted-foreground"
            )}
          >
            {row.state === "ok" ? (
              <CheckIcon className="size-3.5" aria-hidden />
            ) : row.state === "fail" ? (
              <XIcon className="size-3.5" aria-hidden />
            ) : (
              <CircleIcon className="size-3.5" aria-hidden />
            )}
            <span>{row.label}</span>
            <span className="sr-only">
              {row.state === "ok" ? t("met") : row.state === "fail" ? t("notMet") : t("checkedByServer")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
