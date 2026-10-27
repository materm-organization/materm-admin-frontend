"use client";

import { KeyRoundIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { ErrorState } from "@/components/global/states/error-state";
import { ForbiddenState } from "@/components/global/states/forbidden-state";
import { ProfileForm } from "@/components/protected/profile/profile-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useProfile } from "@/hooks/use-profile";
import { isNoPermissionError } from "@/lib/api-error";
import type { UserProfile } from "@/types/user";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all">{value}</dd>
    </div>
  );
}

function AccountFacts({ profile }: { profile: UserProfile }) {
  const t = useTranslations("profile.facts");
  const format = useFormatter();
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : "—";
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Fact label={t("username")} value={profile.username} />
      <Fact label={t("email")} value={profile.email ?? "—"} />
      <Fact label={t("role")} value={profile.role_name} />
      <Fact label={t("allowedLocales")} value={profile.allowed_locales.length ? profile.allowed_locales.join(", ") : t("allLocales")} />
      <Fact label={t("lastLogin")} value={when(profile.last_login_at)} />
      <Fact label={t("passwordChanged")} value={when(profile.password_changed_at)} />
    </dl>
  );
}

// SCR-06 (doc/07 section 3.3): the signed-in user's own name + preferred language (ETag / If-Match with the
// ConflictDialog), read-only account facts, and the change-password dialog. Open to every signed-in user.
export function ProfileView() {
  const t = useTranslations("profile");
  const query = useProfile();
  const [passwordOpen, setPasswordOpen] = useState(false);
  // Bumped after "load the latest version" so the form drops my edits even if the ETag did not change.
  const [reloads, setReloads] = useState(0);
  const profile = query.data?.data.data;
  const etag = query.data?.etag;

  if (query.isLoading) return <EditorSkeleton />;
  if (query.error && isNoPermissionError(query.error)) return <ForbiddenState />;
  if (query.error || !profile) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  }

  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("sections.account.title")}</CardTitle>
          <CardDescription>{t("sections.account.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <AccountFacts profile={profile} />
          <ProfileForm
            key={`${etag ?? ""}|${profile.name}|${profile.preferred_locale ?? ""}|${reloads}`}
            profile={profile}
            etag={etag}
            onReload={async () => {
              await query.refetch();
              setReloads((n) => n + 1);
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("sections.password.title")}</CardTitle>
          <CardDescription>{t("sections.password.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => setPasswordOpen(true)}>
            <KeyRoundIcon />
            {t("sections.password.button")}
          </Button>
        </CardContent>
      </Card>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  );
}
