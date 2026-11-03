"use client";

import { useTranslations } from "next-intl";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCan } from "@/hooks/use-permission";
import { useUsers } from "@/hooks/use-users";
import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import { cn } from "@/lib/utils";
import type { AuthorUserRef } from "@/types/authors";

const NONE = "__none__";

// The optional link from an author to a sign-in user (doc/05 15.2). Listing users needs `iam.users:read`, which an editor does not
// have: then the linked user is only shown (the server keeps the link as it is) and the picker is off.
export function AuthorUserField({
  id,
  userId,
  user,
  disabled,
  error,
  onChange,
}: {
  id: string;
  userId: number | null;
  user: AuthorUserRef | null;
  disabled: boolean;
  error?: string;
  onChange: (userId: number | null, user: AuthorUserRef | null) => void;
}) {
  const t = useTranslations("authors.dialog");
  const canListUsers = useCan(PERMISSION_KEYS.IAM_USERS, "read");
  const users = useUsers({ limit: 100 }, canListUsers);
  const rows = users.data?.data ?? [];
  // The linked user, also when it is not in the first 100 or the list is not readable.
  const known = user ?? (userId !== null ? { id: userId, name: `#${userId}`, username: "" } : null);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("user")}</Label>
      {canListUsers ? (
        <Select
          value={userId === null ? NONE : String(userId)}
          disabled={disabled}
          onValueChange={(v) => {
            if (v === NONE) return onChange(null, null);
            const found = rows.find((u) => String(u.id) === v);
            onChange(Number(v), found ? { id: found.id, name: found.name, username: found.username } : known);
          }}
        >
          <SelectTrigger id={id} className="w-full" aria-invalid={Boolean(error)}>
            <SelectValue placeholder={t("userNone")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("userNone")}</SelectItem>
            {known && !rows.some((u) => u.id === known.id) ? <SelectItem value={String(known.id)}>{known.name}</SelectItem> : null}
            {rows.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.name} ({u.username})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p id={id} className="flex h-9 items-center text-sm" data-testid="author-user-readonly">
          {known ? `${known.name}${known.username ? ` (${known.username})` : ""}` : t("userNone")}
        </p>
      )}
      <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined}>
        {error ?? (canListUsers ? t("userHelp") : t("userReadOnly"))}
      </p>
    </div>
  );
}
