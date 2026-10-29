"use client";

import { ArrowLeftIcon, MailIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/global/states/error-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { NoPermission } from "@/components/layout/no-permission";
import { SubmissionStatusBadge } from "@/components/protected/submissions/submission-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useFetchCurrentUser } from "@/hooks/use-auth";
import { useMutationAddSubmissionNote, useMutationSetSubmissionStatus, useSubmission } from "@/hooks/use-submissions";
import { isConflictError, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { newIdempotencyKey } from "@/lib/idempotency";
import { userCan } from "@/lib/permissions";
import { MAX_NOTE, SUBMISSION_TRANSITIONS, replyMailto } from "@/lib/submissions";
import type { SubmissionStatus } from "@/types/submissions";

// A value of a field or of `extra`, as TEXT. Strings keep their line breaks (`whitespace-pre-wrap`), booleans are Yes / No and
// anything else is JSON in a `<pre>`. React escapes all of it: nothing here is ever HTML (a visitor can type `<script>`).
function Value({ value }: { value: unknown }) {
  const t = useTranslations("submissions.detail");
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">{t("empty")}</span>;
  if (typeof value === "boolean") return <span>{value ? t("yes") : t("no")}</span>;
  if (typeof value === "string") return <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</span>;
  if (typeof value === "number") return <span className="tabular-nums">{value}</span>;
  return <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

function Row({ label, children, mono = false }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={mono ? "min-w-0 break-all font-mono text-sm" : "min-w-0 text-sm [overflow-wrap:anywhere]"}>{children}</dd>
    </div>
  );
}

// The labels of the buttons that move a message, by (from, to).
const moveKey = (from: SubmissionStatus, to: SubmissionStatus) => (from === "spam" && to === "new" ? "notSpam" : from === "archived" && to === "read" ? "reopen" : to);

// SCR-32 detail (doc/07 section 3.20): one message. Reading it does nothing on the server; a person who may change messages marks a
// NEW one as read after it has stayed open for a second (C-09). Status buttons offer only the moves the status table allows from
// the current status (none for an anonymised message); notes are append-only; "Reply" opens the mail program and then asks whether to
// mark the message as replied. Personal data: the cached answer is dropped after a minute, nothing goes to storage or to a log.
export function SubmissionDetailView({ id }: { id: number }) {
  const t = useTranslations("submissions.detail");
  const tStatus = useTranslations("submissions.status");
  const tMove = useTranslations("submissions.detail.moves");
  const format = useFormatter();
  const { toastError } = useApiErrorHandler();
  const params = useSearchParams();
  const createdAt = params.get("created_at") ?? undefined;
  const me = useFetchCurrentUser().data?.data;
  const canUpdate = userCan(me?.permissions, PERMISSION_KEYS.FORMS_SUBMISSIONS, PERMISSION_ACTIONS.UPDATE);
  const canReadForms = userCan(me?.permissions, PERMISSION_KEYS.FORMS_MANAGE, PERMISSION_ACTIONS.READ);

  const query = useSubmission(id, createdAt);
  const setStatus = useMutationSetSubmissionStatus(createdAt);
  const addNote = useMutationAddSubmissionNote(createdAt);
  const s = query.data?.data.data;
  const etag = query.data?.etag;
  useBreadcrumbTitle(query.error ? null : s ? `#${s.id}` : undefined);

  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const noteKey = useRef<string | null>(null);

  // New -> read after one second, once per message. A 409 (somebody else already moved it) is not worth a word.
  const autoRead = useRef<number | null>(null);
  const mutateStatus = setStatus.mutate;
  const isNew = s?.status === "new" && !s.anonymized_at;
  useEffect(() => {
    if (!canUpdate || !isNew || autoRead.current === id) return;
    const timer = window.setTimeout(() => {
      autoRead.current = id;
      mutateStatus({ id, status: "read" }, { onError: () => undefined });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [canUpdate, isNew, id, mutateStatus]);

  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  if (query.error && parseApiError(query.error).status === 404) {
    return <NotFoundState title={t("notFoundTitle")} description={t("notFoundDescription")} backHref="/admin/forms/submissions" backLabel={t("backToList")} />;
  }
  if (query.error && !s) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!s) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const anonymised = s.anonymized_at !== null;
  const moves = anonymised ? [] : SUBMISSION_TRANSITIONS[s.status];
  const mailto = anonymised ? null : replyMailto(s.sender_email, s.topic);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const move = async (to: SubmissionStatus) => {
    try {
      await setStatus.mutateAsync({ id, status: to, etag });
      setAsking(false);
      toast.success(t("moved", { status: tStatus(to) }));
    } catch (error) {
      const parsed = parseApiError(error);
      if (isConflictError(error) || (parsed.status === 409 && parsed.code === "INVALID_STATE")) {
        toast.error(t("stale"));
        void query.refetch();
      } else toastError(error, t("moveFailed"));
    }
  };

  const submitNote = async () => {
    const text = note.trim();
    if (text === "") return setNoteError(t("notes.required"));
    if ([...text].length > MAX_NOTE) return setNoteError(t("notes.tooLong", { max: MAX_NOTE }));
    setNoteError(undefined);
    noteKey.current ??= newIdempotencyKey();
    try {
      await addNote.mutateAsync({ id, note: text, idempotencyKey: noteKey.current });
      noteKey.current = null;
      setNote("");
      toast.success(t("notes.added"));
    } catch (error) {
      if (parseApiError(error).status === 409) {
        setNoteError(t("notes.anonymised"));
        void query.refetch();
      } else toastError(error, t("notes.failed"));
    }
  };

  return (
    <div className="space-y-6" data-testid="submission-detail">
      <div>
        <Link href="/admin/forms/submissions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          {t("backToList")}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="break-words text-2xl font-semibold tracking-wide">{anonymised ? t("anonymisedTitle", { id: s.id }) : (s.sender_name ?? t("noName"))}</h1>
          <SubmissionStatusBadge status={s.status} />
          {s.retention_overdue ? <Badge variant="destructive">{t("retentionOverdue")}</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {canReadForms ? (
            <Link href={`/admin/forms/${s.form.id}`} className="underline-offset-4 hover:underline">
              {s.form.name}
            </Link>
          ) : (
            s.form.name
          )}
          {" - "}
          {when(s.created_at)}
        </p>
      </div>

      {anonymised ? (
        <Alert data-testid="anonymised-note">
          <AlertTitle>{t("anonymisedNoteTitle")}</AlertTitle>
          <AlertDescription>{t("anonymisedNote", { date: when(s.anonymized_at!) })}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("actions")}>
        {mailto ? (
          <Button asChild variant="outline">
            <a href={mailto} onClick={() => setAsking(canUpdate && SUBMISSION_TRANSITIONS[s.status].includes("replied"))}>
              <MailIcon />
              {t("reply")}
            </a>
          </Button>
        ) : null}
        {canUpdate
          ? moves.map((to) => (
              <Button key={to} type="button" variant={to === "spam" ? "ghost" : "outline"} disabled={setStatus.isPending} onClick={() => void move(to)}>
                {setStatus.isPending && setStatus.variables?.status === to ? <Spinner /> : null}
                {tMove(moveKey(s.status, to))}
              </Button>
            ))
          : null}
      </div>
      {asking ? (
        <Alert data-testid="ask-replied">
          <AlertTitle>{t("askReplied.title")}</AlertTitle>
          <AlertDescription>
            <span className="block">{t("askReplied.body")}</span>
            <span className="mt-2 flex gap-2">
              <Button type="button" size="sm" onClick={() => void move("replied")}>
                {t("askReplied.yes")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setAsking(false)}>
                {t("askReplied.no")}
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {!anonymised ? (
            <section className="space-y-3 rounded-lg border p-4" aria-labelledby="submission-fields">
              <h2 id="submission-fields" className="text-sm font-semibold">
                {t("fields")}
              </h2>
              <dl className="space-y-3" data-testid="submission-fields">
                {s.fields.map((f) => (
                  <Row key={f.key} label={f.label}>
                    <Value value={f.value} />
                  </Row>
                ))}
                {Object.entries(s.extra).map(([key, value]) => (
                  <Row key={key} label={<span className="font-mono">{key}</span>}>
                    <Value value={value} />
                  </Row>
                ))}
              </dl>
              {Object.keys(s.extra).length > 0 ? <p className="text-xs text-muted-foreground">{t("extraNote")}</p> : null}
            </section>
          ) : null}

          {!anonymised ? (
            <section className="space-y-3 rounded-lg border p-4" aria-labelledby="submission-notes">
              <h2 id="submission-notes" className="text-sm font-semibold">
                {t("notes.title")}
              </h2>
              {s.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("notes.none")}</p>
              ) : (
                <ul className="space-y-3" data-testid="submission-notes">
                  {s.notes.map((n) => (
                    <li key={n.id} className="rounded-md bg-muted/40 p-3">
                      <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{n.note}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {n.author?.name ?? t("notes.unknownAuthor")} - {when(n.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {canUpdate ? (
                <div className="space-y-2">
                  <label htmlFor="submission-note-input" className="text-sm font-medium">
                    {t("notes.add")}
                  </label>
                  <Textarea
                    id="submission-note-input"
                    value={note}
                    rows={3}
                    maxLength={MAX_NOTE + 200}
                    aria-invalid={noteError ? true : undefined}
                    aria-describedby="submission-note-hint"
                    onChange={(e) => {
                      setNote(e.target.value);
                      setNoteError(undefined);
                    }}
                  />
                  <div id="submission-note-hint" className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{t("notes.hint")}</span>
                    <span className="tabular-nums">
                      {[...note].length} / {MAX_NOTE}
                    </span>
                  </div>
                  {noteError ? <p role="alert" className="text-sm text-destructive">{noteError}</p> : null}
                  <Button type="button" disabled={addNote.isPending} onClick={() => void submitNote()}>
                    {addNote.isPending ? <Spinner /> : null}
                    {t("notes.submit")}
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <section className="h-fit space-y-3 rounded-lg border p-4" aria-labelledby="submission-meta">
          <h2 id="submission-meta" className="text-sm font-semibold">
            {t("meta.title")}
          </h2>
          <dl className="space-y-3">
            <Row label={t("meta.received")}>{when(s.created_at)}</Row>
            <Row label={t("meta.form")}>{s.form.name}</Row>
            <Row label={t("meta.topic")} mono>{s.topic ?? "-"}</Row>
            {!anonymised ? (
              <>
                <Row label={t("meta.language")}>{s.locale_code ?? "-"}</Row>
                <Row label={t("meta.sourcePath")} mono>{s.source_path ?? "-"}</Row>
                <Row label={t("meta.userAgent")}>{s.user_agent ?? "-"}</Row>
                <Row label={t("meta.ip")} mono>{s.ip_hash_prefix ? `${s.ip_hash_prefix}...` : "-"}</Row>
                <Row label={t("meta.consent")}>{s.consent_at ? `${when(s.consent_at)}${s.consent_version ? ` (${s.consent_version})` : ""}` : "-"}</Row>
                <Row label={t("meta.spamScore")}>{s.spam_score}</Row>
              </>
            ) : null}
            <Row label={t("meta.handled")}>{s.handled_by || s.handled_at ? `${s.handled_by?.name ?? "-"}${s.handled_at ? `, ${when(s.handled_at)}` : ""}` : "-"}</Row>
            <Row label={t("meta.retention")}>{format.dateTime(new Date(s.retention_until), { dateStyle: "medium" })}</Row>
          </dl>
        </section>
      </div>
    </div>
  );
}
