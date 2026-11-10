"use client";

import { CalendarClockIcon, CalendarXIcon, EyeIcon, EyeOffIcon, PackageOpenIcon, RocketIcon, SaveIcon, SendIcon, Undo2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ConflictDialog } from "@/components/global/conflict-dialog";
import { PublishBlockersDialog } from "@/components/global/publishing/publish-blockers-dialog";
import { PublishConfirmDialog } from "@/components/global/publishing/publish-confirm-dialog";
import { ReferencedDialog, type ReferencedItem } from "@/components/global/publishing/referenced-dialog";
import { RejectDialog } from "@/components/global/publishing/reject-dialog";
import { ScheduleDialog, type ScheduleDialogMode } from "@/components/global/publishing/schedule-dialog";
import { ScheduleStatusLine } from "@/components/global/publishing/schedule-status";
import { SubmitReviewDialog } from "@/components/global/publishing/submit-review-dialog";
import { StatusBadge } from "@/components/global/status/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useCan } from "@/hooks/use-permission";
import { usePublishCapabilities } from "@/hooks/use-publish-capabilities";
import {
  useMutationDiscardDraft,
  useMutationPublish,
  useMutationReject,
  useMutationSchedule,
  useMutationSubmitReview,
  useMutationUnpublish,
  useMutationUnschedule,
} from "@/hooks/use-publishing";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { PUBLISHABLE_RESOURCES, type PublishableResource } from "@/lib/publishable-resources";
import { classifyScheduleError, scheduleHealth, type ScheduleProblem } from "@/lib/publishing-schedule";
import { cn } from "@/lib/utils";
import type {
  CommandWarning,
  PublishBlockedDetails,
  PublishDryRunResult,
  PublishIssue,
  PublishIssueTarget,
  PublishableCommandResult,
  PublishableState,
  ScheduleInfo,
} from "@/types/publishing";

// D1 adds the review and schedule commands.
export type PublishBarAction = "publish" | "unpublish" | "discard" | "submit_review" | "reject" | "schedule" | "unschedule";

// What a command hands back to the host: the root in the shape of its own GET (+ `aggregate`, `warnings`) and its NEW
// ETag. The host puts both into its cache (`setQueryData`) - no refetch, the next write must carry this ETag.
export type PublishBarResult = {
  action: PublishBarAction;
  data: PublishableCommandResult;
  etag: string | undefined;
  warnings: CommandWarning[];
};

export type PublishBarProps = {
  // Which publishable entity (URLs and the permission key come from `lib/publishable-resources.ts`).
  resource: PublishableResource;
  // The lifecycle fields of the entity (list row or detail): status, pending draft, home / trash flags.
  entity: PublishableState;
  // The entity's CURRENT ETag as the host holds it - the `If-Match` of every command. Without it nothing is sent.
  etag: string | undefined;
  // Unsaved edits in the host's form. Publish stays disabled until they are saved (the draft is what gets published).
  isDirty?: boolean;
  // Makes the host write what is pending now (an autosave timer, a save in flight) and says whether it is all saved.
  // Called before the dry run; `false` stops the publish.
  flush?: () => Promise<boolean>;
  // "Save draft": the host's own save (its PATCH, its ETag handling). Without it the button is not shown.
  onSaveDraft?: () => void | Promise<unknown>;
  isSaving?: boolean;
  // Every successful command, with the new ETag.
  onResult: (result: PublishBarResult) => void | Promise<void>;
  // "Load the latest version" of the conflict dialog (409): refetch the entity and its ETag.
  onRefresh?: () => void | Promise<unknown>;
  // "Go to field" of a blocker: open the language / section / field the pointer names.
  onGoToField?: (target: PublishIssueTarget) => void;
  // Opens the host's `PreviewLinkDialog` (T1.4.4 UI). Without a handler the button is shown disabled with a tooltip.
  onCreatePreviewLink?: () => void;
  // What the host knows about the consequences of a command (shared sections: the pages that show it, from `GET .../usages`), shown inside the
  // publish confirmation / the unpublish confirmation.
  confirmExtras?: { publish?: ReactNode; unpublish?: ReactNode };
  className?: string;
};

// Warnings of a success the user should read (not only a toast): the draft kept in the History, links that are hidden.
const NOTICE_CODES = new Set(["draft_kept_as_history", "shared_section_referenced", "page_referenced", "post_referenced", "album_referenced", "faq_group_referenced", "form_referenced", "path_changed_published", "slug_changed_published", "auto_redirect_skipped"]);

// The automatic 301 redirects a publish made when a published page changed path / a published post changed slug (doc/05
// 14.12). Created / updated / cleanup are information (a short toast with a link to the Redirects screen); `skipped` is a
// warning the editor must act on, so it stays on the page as a notice.
const AUTO_REDIRECT_INFO_CODES = new Set(["auto_redirect_created", "auto_redirect_updated", "auto_redirect_cleanup"]);
const REDIRECTS_URL = "/admin/redirects";

// ICU arguments of a notice from its `params` (primitives only).
function noticeValues(notice: CommandWarning): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(notice.params ?? {})) if (typeof v === "string" || typeof v === "number") out[k] = v;
  // Same for the redirect warnings, whose `params` also carry arrays and null (`locale_code: null` = every language).
  const p = (notice.params ?? {}) as Record<string, unknown>;
  out.scope = typeof p.locale_code === "string" && p.locale_code ? ` (${p.locale_code})` : "";
  if (Array.isArray(p.path)) out.loop_path = p.path.join(" > ");
  for (const key of ["trashed", "deactivated", "repointed"]) {
    const list = p[key];
    out[key] = Array.isArray(list) ? list.length : 0;
  }
  return out;
}

// A clock for "overdue": refreshed twice a minute, so a schedule that passes its time while the page is open turns amber without a reload.
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function DisabledHint({ reason, children }: { reason: string | null; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex" data-testid="disabled-hint">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

// SCR-38 PublishBar (doc/07 sections 2.5.7 and 3.24, doc/05 section 12.7): the lifecycle chip and the commands of a
// publishable entity - Save draft (the host's), Publish, Unpublish, Discard draft, Create preview link - for any `resource`.
//
//  - Publish does a DRY RUN first (`?dry_run=true`, no ETag change): a 422 `PUBLISH_BLOCKED` opens the blockers dialog
//    ("Go to field" links call `onGoToField`), a pass opens the confirmation with what will happen (incomplete languages,
//    warnings); only the confirmation sends the real publish. The dry run counts toward the publish rate limit (05 12.7.6),
//    which is why the real one does not repeat the check client-side.
//  - Unpublish asks first; a 409 `ENTITY_REFERENCED` lists who links to it and asks again, the repeat carries
//    `confirm_references=true` (never the first request). Unpublish never fails because of a pending draft: the answer's
//    warning `draft_kept_as_history` is shown as a notice. A page that is the home page has no Unpublish button.
//  - Discard draft asks first; the draft stays in the History.
//  - One `Idempotency-Key` per action (per dialog open; the `confirm_references` repeat is another request, another key).
//  - 409 `CONFLICT_LOCK_VERSION` opens the ConflictDialog; the new ETag of every answer goes to `onResult`.
//  - D1 (doc/05 12.10 - 12.11, doc/07 2.5.7): Submit for review (draft; pages, posts), Reject... with a required comment (in review; `review`),
//    Schedule... / Schedule changes... (draft, in review, archived, published with a draft; `schedule` AND `publish`, BR-11) and, for a booked
//    entity, the line "Scheduled for <time>" (Asia/Vientiane; overdue / failed variants) with Reschedule..., Cancel schedule and Publish now.
//    Schedule runs the publish DRY RUN first (blockers show before a time is picked), then `ScheduleDialog`; the server checks the rules again.
//    Submit, Reject and Schedule are POSTs with one `Idempotency-Key` per dialog open; the unschedule DELETE has none. Rights live in
//    `usePublishCapabilities` (also BR-10: an `update_own`-only author can not touch a post in review or scheduled).
//  - Controls the user may not use are not shown; permission keys come from the resource (`cms.pages`: publish, unpublish,
//    update for discard / save, read + update | review for preview).
export function PublishBar({
  resource,
  entity,
  etag,
  isDirty = false,
  flush,
  onSaveDraft,
  isSaving = false,
  onResult,
  onRefresh,
  onGoToField,
  onCreatePreviewLink,
  confirmExtras,
  className,
}: PublishBarProps) {
  const t = useTranslations("publishing");
  const config = PUBLISHABLE_RESOURCES[resource];
  const noun = t(`noun.${resource}`);
  const router = useRouter();
  const { toastError } = useApiErrorHandler();

  // A kind with `update_own` (posts): the creator may save, discard and issue preview links of their own thing; publish and
  // unpublish never count the creator. Review / schedule rules and BR-10 (`authorLocked`) live in the hook.
  const { canPublish, canUnpublish, canUpdate, canTranslate, canRead, canPreviewAction, canSubmitReview, canReject, canSchedule, authorLocked } = usePublishCapabilities(resource, entity);
  const canOpenRedirects = useCan(PERMISSION_KEYS.CMS_REDIRECTS, PERMISSION_ACTIONS.READ);

  const publishMutation = useMutationPublish(resource, entity.id);
  const unpublishMutation = useMutationUnpublish(resource, entity.id);
  const discardMutation = useMutationDiscardDraft(resource, entity.id);
  const submitMutation = useMutationSubmitReview(resource, entity.id);
  const rejectMutation = useMutationReject(resource, entity.id);
  const scheduleMutation = useMutationSchedule(resource, entity.id);
  const unscheduleMutation = useMutationUnschedule(resource, entity.id);

  const [busy, setBusy] = useState<"checking" | "publishing" | "unpublishing" | "discarding" | "submitting" | "rejecting" | "scheduling" | "unscheduling" | null>(null);
  const [confirm, setConfirm] = useState<{ warnings: PublishIssue[] } | null>(null);
  const [blocked, setBlocked] = useState<{ blockers: PublishIssue[]; warnings: PublishIssue[]; count?: number; truncated: boolean } | null>(null);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [referenced, setReferenced] = useState<{ items: ReferencedItem[]; total: number } | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [notices, setNotices] = useState<CommandWarning[]>([]);
  // D1: the schedule dialog (the dry run already passed; `warnings` are its notes), the review dialogs and the cancel-schedule confirmation.
  const [scheduleDialog, setScheduleDialog] = useState<{ mode: ScheduleDialogMode; warnings: PublishIssue[] } | null>(null);
  const [scheduleProblem, setScheduleProblem] = useState<ScheduleProblem | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectProblem, setRejectProblem] = useState<ScheduleProblem | null>(null);
  const [cancelScheduleOpen, setCancelScheduleOpen] = useState(false);
  const now = useNow(30_000);

  // One key per action: a new one whenever its dialog opens, kept for a retry of the same dialog. The repeat with
  // `confirm_references` is a different request, so it has a key of its own.
  const publishKey = useIdempotencyKey(confirm !== null);
  const unpublishKey = useIdempotencyKey(unpublishOpen);
  const referencedKey = useIdempotencyKey(referenced !== null);

  const trashed = Boolean(entity.deleted_at);
  const pending = entity.has_unpublished_changes;
  const status = entity.status;
  const isPublished = status === "published" || status === "scheduled";
  // D1: the schedule of the entity. A `scheduled` root whose detail carries no `schedule` member falls back to the root's `scheduled_at`.
  const schedule: ScheduleInfo | null =
    entity.schedule ?? (status === "scheduled" && entity.scheduled_at ? { action: "publish", run_at: entity.scheduled_at, status: "pending", attempts: 0, last_error: null } : null);
  const isScheduled = status === "scheduled";
  // A published entity whose pending draft is booked (`apply_revision`) keeps `published`; its time is shown and can be moved or cancelled.
  const hasBooking = isScheduled || (status === "published" && schedule !== null);
  const health = hasBooking ? scheduleHealth(schedule, now) : "ok";
  const showPublish = canPublish && !trashed && (status !== "published" || pending);
  const showDiscard = canUpdate && !authorLocked && !trashed && status === "published" && pending;
  const showUnpublish = canUnpublish && !trashed && isPublished && !entity.is_home;
  const showSave = Boolean(onSaveDraft) && (canUpdate || canTranslate) && !authorLocked && !trashed;
  const showSubmit = canSubmitReview && !trashed && status === "draft";
  const showReject = canReject && !trashed && status === "in_review";
  const showSchedule = canSchedule && !trashed && !hasBooking && (status === "draft" || status === "in_review" || status === "archived" || (status === "published" && pending));
  const showBookingCommands = canSchedule && !trashed && hasBooking;
  // Preview links exist only for the kinds the resource entry names (pages, posts: PT-18); the user needs read + update | review.
  const showPreview = config.previewLinks && canRead && canPreviewAction && !trashed;
  const busyAny = busy !== null;
  const noEtag = etag === undefined;

  const reload = async () => {
    setIsReloading(true);
    try {
      await onRefresh?.();
    } finally {
      setIsReloading(false);
    }
  };

  // One place for what a failed command means.
  const handleError = async (error: unknown, fallbackKey: string): Promise<"blocked" | "referenced" | "conflict" | "stale" | "toast"> => {
    if (isConflictError(error)) {
      setConflictOpen(true);
      return "conflict";
    }
    const parsed = parseApiError(error);
    if (parsed.code === "PUBLISH_BLOCKED" && parsed.status === 422) {
      const details = (parsed.details ?? {}) as PublishBlockedDetails;
      setBlocked({
        blockers: parsed.fieldErrors as unknown as PublishIssue[],
        warnings: details.warnings ?? [],
        count: details.blocker_count,
        truncated: details.truncated === true,
      });
      return "blocked";
    }
    if (parsed.code === "ENTITY_REFERENCED" && parsed.status === 409) {
      const details = (parsed.details ?? {}) as { references?: ReferencedItem[]; total_references?: number };
      setReferenced({ items: details.references ?? [], total: details.total_references ?? details.references?.length ?? 0 });
      return "referenced";
    }
    if (parsed.code === "INVALID_STATE" && parsed.status === 409) {
      const reason = String(parsed.details?.reason ?? "");
      toast.error(t.has(`invalidState.${reason}`) ? t(`invalidState.${reason}`, { noun }) : t("invalidState.other", { noun }));
      // The entity is not in the state the page showed: load what it is now.
      await onRefresh?.();
      return "stale";
    }
    toastError(error, t(fallbackKey));
    return "toast";
  };

  const finish = async (action: PublishBarAction, response: { data: unknown; etag: string | undefined }) => {
    const envelope = response.data as { data: PublishableCommandResult; details?: { warnings?: CommandWarning[] } };
    // The spec puts a success' warnings in `data.warnings[]`; `details.warnings[]` of the envelope is read as well.
    const warnings = [...(envelope.data.warnings ?? []), ...(envelope.details?.warnings ?? [])];
    setNotices(warnings.filter((w) => NOTICE_CODES.has(w.code)));
    await onResult({ action, data: envelope.data, etag: response.etag, warnings });
    toast.success(t(`toast.${action}`));
    for (const info of warnings.filter((w) => AUTO_REDIRECT_INFO_CODES.has(w.code))) {
      toast.info(t(`autoRedirect.${info.code}`, noticeValues(info)), canOpenRedirects ? { action: { label: t("autoRedirect.open"), onClick: () => router.push(REDIRECTS_URL) } } : undefined);
    }
  };

  // --- Publish -------------------------------------------------------------------------------------------------------
  const startPublish = async () => {
    setNotices([]);
    setBusy("checking");
    try {
      if (flush) {
        const saved = await flush();
        if (!saved) {
          toast.error(t("toast.saveFirst"));
          return;
        }
      }
      const response = await publishMutation.mutateAsync({ etag, dryRun: true });
      const dry = response.data.data as PublishDryRunResult;
      setConfirm({ warnings: dry.warnings ?? [] });
    } catch (error) {
      await handleError(error, "toast.publishFailed");
    } finally {
      setBusy(null);
    }
  };

  const doPublish = async (changeNote: string | undefined) => {
    setBusy("publishing");
    try {
      const response = await publishMutation.mutateAsync({ etag, changeNote, idempotencyKey: publishKey });
      setConfirm(null);
      await finish("publish", response);
    } catch (error) {
      // A plain failure (network, 5xx) keeps the dialog open: the retry reuses the same Idempotency-Key.
      const outcome = await handleError(error, "toast.publishFailed");
      if (outcome !== "toast") setConfirm(null);
    } finally {
      setBusy(null);
    }
  };

  // --- Unpublish -----------------------------------------------------------------------------------------------------
  const doUnpublish = async (confirmReferences: boolean) => {
    setBusy("unpublishing");
    try {
      const response = await unpublishMutation.mutateAsync({ etag, confirmReferences, idempotencyKey: confirmReferences ? referencedKey : unpublishKey });
      setUnpublishOpen(false);
      setReferenced(null);
      await finish("unpublish", response);
    } catch (error) {
      setUnpublishOpen(false);
      const outcome = await handleError(error, "toast.unpublishFailed");
      if (outcome !== "referenced") setReferenced(null);
    } finally {
      setBusy(null);
    }
  };

  // --- Discard -------------------------------------------------------------------------------------------------------
  const doDiscard = async () => {
    setBusy("discarding");
    try {
      const response = await discardMutation.mutateAsync({ etag });
      setDiscardOpen(false);
      await finish("discard", response);
    } catch (error) {
      setDiscardOpen(false);
      await handleError(error, "toast.discardFailed");
    } finally {
      setBusy(null);
    }
  };

  // --- Schedule (D1) -------------------------------------------------------------------------------------------------
  // The publish DRY RUN comes first, exactly like a publish: blockers show before anybody picks a time (the server runs the rules again at the
  // schedule and at the fire). The dry run counts toward the publish limit, as it does for Publish.
  const startSchedule = async (mode: ScheduleDialogMode) => {
    setNotices([]);
    setScheduleProblem(null);
    setBusy("checking");
    try {
      if (flush) {
        const saved = await flush();
        if (!saved) {
          toast.error(t("toast.saveFirstSchedule"));
          return;
        }
      }
      const response = await publishMutation.mutateAsync({ etag, dryRun: true });
      const dry = response.data.data as PublishDryRunResult;
      setScheduleDialog({ mode, warnings: dry.warnings ?? [] });
    } catch (error) {
      await handleError(error, "toast.scheduleFailed");
    } finally {
      setBusy(null);
    }
  };

  const doSchedule = async (scheduledAt: string, idempotencyKey: string) => {
    setBusy("scheduling");
    try {
      const response = await scheduleMutation.mutateAsync({ etag, scheduledAt, idempotencyKey });
      setScheduleDialog(null);
      setScheduleProblem(null);
      await finish("schedule", response);
    } catch (error) {
      const problem = classifyScheduleError(error);
      // The refusals the dialog explains in place (the time is out of range, too many schedules) keep it open.
      if (problem.kind === "range" || problem.kind === "required" || problem.kind === "format" || problem.kind === "rate") {
        setScheduleProblem(problem);
      } else {
        const outcome = await handleError(error, "toast.scheduleFailed");
        if (outcome !== "toast") setScheduleDialog(null);
      }
    } finally {
      setBusy(null);
    }
  };

  const doUnschedule = async () => {
    setBusy("unscheduling");
    try {
      const response = await unscheduleMutation.mutateAsync({ etag });
      setCancelScheduleOpen(false);
      await finish("unschedule", response);
    } catch (error) {
      setCancelScheduleOpen(false);
      await handleError(error, "toast.unscheduleFailed");
    } finally {
      setBusy(null);
    }
  };

  // --- Review (D1) ---------------------------------------------------------------------------------------------------
  const startSubmit = async () => {
    setNotices([]);
    if (flush && !(await flush())) {
      toast.error(t("toast.saveFirstReview"));
      return;
    }
    setSubmitOpen(true);
  };

  const doSubmit = async (note: string | undefined, idempotencyKey: string) => {
    setBusy("submitting");
    try {
      const response = await submitMutation.mutateAsync({ etag, note, idempotencyKey });
      setSubmitOpen(false);
      await finish("submit_review", response);
    } catch (error) {
      const outcome = await handleError(error, "toast.submitReviewFailed");
      if (outcome !== "toast") setSubmitOpen(false);
    } finally {
      setBusy(null);
    }
  };

  const doReject = async (comment: string, idempotencyKey: string) => {
    setBusy("rejecting");
    try {
      const response = await rejectMutation.mutateAsync({ etag, comment, idempotencyKey });
      setRejectOpen(false);
      setRejectProblem(null);
      await finish("reject", response);
    } catch (error) {
      const problem = classifyScheduleError(error);
      if (problem.kind === "commentRequired" || problem.kind === "commentTooLong") {
        setRejectProblem(problem);
      } else {
        const outcome = await handleError(error, "toast.rejectFailed");
        if (outcome !== "toast") setRejectOpen(false);
      }
    } finally {
      // The comment is the mutation's variables: drop them from the observer too (the dialog's own text is gone with its content).
      rejectMutation.reset();
      setBusy(null);
    }
  };

  // The text of a notice; `auto_redirect_skipped` has one per reason (and says what to do), an unknown reason the generic one.
  const noticeBody = (notice: CommandWarning): string => {
    const values = noticeValues(notice);
    if (notice.code === "auto_redirect_skipped") {
      const reason = String(notice.params?.reason ?? "");
      return t(t.has(`notices.auto_redirect_skipped.reason.${reason}`) ? `notices.auto_redirect_skipped.reason.${reason}` : "notices.auto_redirect_skipped.reason.other", values);
    }
    return t.has(`notices.${notice.code}.body`) ? t(`notices.${notice.code}.body`, values) : (notice.message ?? "");
  };

  const publishReason = noEtag ? t("hints.loading") : isDirty ? t("hints.dirty") : null;
  // Submit for review / schedule act on the SAVED version, so they wait for unsaved edits like Publish does.
  const reviewReason = noEtag ? t("hints.loading") : isDirty ? t("hints.dirtyReview") : null;
  const scheduleReason = noEtag ? t("hints.loading") : isDirty ? t("hints.dirtySchedule") : null;
  const saveReason = !isDirty ? t("hints.nothingToSave") : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("space-y-2", className)} data-testid="publish-bar" role="group" aria-label={t("barLabel")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusBadge status={entity.status} hasUnpublishedChanges={pending} trashed={trashed} scheduleHealth={health} />
          {isDirty ? (
            <span className="text-xs text-muted-foreground" data-testid="publish-dirty">
              {t("hints.unsaved")}
            </span>
          ) : null}
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {showSave ? (
              <DisabledHint reason={saveReason}>
                <Button type="button" variant="outline" size="sm" disabled={!isDirty || isSaving || busyAny} onClick={() => void onSaveDraft?.()}>
                  {isSaving ? <Spinner /> : <SaveIcon />}
                  {isSaving ? t("actions.saving") : t("actions.saveDraft")}
                </Button>
              </DisabledHint>
            ) : null}
            {showPreview ? (
              <DisabledHint reason={onCreatePreviewLink ? null : t("hints.previewUnavailable")}>
                <Button type="button" variant="outline" size="sm" disabled={!onCreatePreviewLink || busyAny} onClick={() => onCreatePreviewLink?.()}>
                  <EyeIcon />
                  {t("actions.preview")}
                </Button>
              </DisabledHint>
            ) : null}
            {showDiscard ? (
              <Button type="button" variant="outline" size="sm" disabled={busyAny || noEtag} onClick={() => setDiscardOpen(true)}>
                <Undo2Icon />
                {t("actions.discard")}
              </Button>
            ) : null}
            {showReject ? (
              <Button type="button" variant="outline" size="sm" disabled={busyAny || noEtag} onClick={() => setRejectOpen(true)}>
                <Undo2Icon />
                {t("actions.reject")}
              </Button>
            ) : null}
            {showBookingCommands ? (
              <>
                <Button type="button" variant="outline" size="sm" disabled={busyAny || noEtag} onClick={() => setCancelScheduleOpen(true)}>
                  <CalendarXIcon />
                  {t("actions.cancelSchedule")}
                </Button>
                <DisabledHint reason={scheduleReason}>
                  <Button type="button" variant="outline" size="sm" disabled={busyAny || Boolean(scheduleReason)} onClick={() => void startSchedule("reschedule")}>
                    {busy === "checking" ? <Spinner /> : <CalendarClockIcon />}
                    {t("actions.reschedule")}
                  </Button>
                </DisabledHint>
              </>
            ) : null}
            {showUnpublish ? (
              <Button type="button" variant="outline" size="sm" disabled={busyAny || noEtag} onClick={() => setUnpublishOpen(true)}>
                <EyeOffIcon />
                {t("actions.unpublish")}
              </Button>
            ) : null}
            {showSubmit ? (
              <DisabledHint reason={reviewReason}>
                <Button type="button" variant="outline" size="sm" disabled={busyAny || Boolean(reviewReason)} onClick={() => void startSubmit()}>
                  {busy === "submitting" ? <Spinner /> : <SendIcon />}
                  {t("actions.submitReview")}
                </Button>
              </DisabledHint>
            ) : null}
            {showSchedule ? (
              <DisabledHint reason={scheduleReason}>
                <Button type="button" variant="outline" size="sm" disabled={busyAny || Boolean(scheduleReason)} onClick={() => void startSchedule(status === "published" ? "changes" : "schedule")}>
                  {busy === "checking" ? <Spinner /> : <CalendarClockIcon />}
                  {status === "published" ? t("actions.scheduleChanges") : t("actions.schedule")}
                </Button>
              </DisabledHint>
            ) : null}
            {showPublish ? (
              <DisabledHint reason={publishReason}>
                <Button type="button" size="sm" disabled={busyAny || Boolean(publishReason)} onClick={() => void startPublish()}>
                  {busy === "checking" || busy === "publishing" ? <Spinner /> : isScheduled ? <RocketIcon /> : pending ? <PackageOpenIcon /> : <RocketIcon />}
                  {isScheduled ? t("actions.publishNow") : pending ? t("actions.publishChanges") : t("actions.publish")}
                </Button>
              </DisabledHint>
            ) : null}
          </div>
        </div>

        {hasBooking && !trashed ? <ScheduleStatusLine schedule={schedule} scheduledAt={entity.scheduled_at} health={health} /> : null}

        {notices.length > 0 ? (
          <div className="space-y-2" data-testid="publish-notices">
            {notices.map((notice, i) => (
              <Alert key={`${notice.code}-${i}`} className="border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100" data-testid={`notice-${notice.code}`}>
                <AlertTitle className="line-clamp-none">{t.has(`notices.${notice.code}.title`) ? t(`notices.${notice.code}.title`, noticeValues(notice)) : notice.code}</AlertTitle>
                <AlertDescription className="flex items-start justify-between gap-2 text-amber-950/90 dark:text-amber-100/90">
                  <span>
                    {noticeBody(notice)}
                    {notice.code === "auto_redirect_skipped" && canOpenRedirects ? (
                      <>
                        {" "}
                        <Link href={REDIRECTS_URL} className="font-medium underline underline-offset-2" data-testid="notice-open-redirects">
                          {t("autoRedirect.open")}
                        </Link>
                      </>
                    ) : null}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="-my-1 size-6 shrink-0"
                    aria-label={t("notices.dismiss")}
                    onClick={() => setNotices((list) => list.filter((_, j) => j !== i))}
                  >
                    <XIcon />
                  </Button>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        ) : null}
      </div>

      <PublishConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        warnings={confirm?.warnings ?? []}
        noun={noun}
        hasChanges={pending}
        isPending={busy === "publishing"}
        extra={confirmExtras?.publish}
        onConfirm={doPublish}
      />
      <PublishBlockersDialog
        open={blocked !== null}
        onOpenChange={(open) => !open && setBlocked(null)}
        blockers={blocked?.blockers ?? []}
        warnings={blocked?.warnings ?? []}
        blockerCount={blocked?.count}
        truncated={blocked?.truncated}
        noun={noun}
        resource={resource}
        onGoToField={onGoToField}
      />
      <ConfirmDialog
        open={unpublishOpen}
        onOpenChange={setUnpublishOpen}
        title={t("unpublish.title", { noun })}
        description={
          <>
            <span>{t("unpublish.description", { noun })}</span>
            {pending ? <span className="mt-2 block">{t("unpublish.withDraft")}</span> : null}
          </>
        }
        extra={confirmExtras?.unpublish}
        confirmLabel={t("unpublish.confirm")}
        destructive
        isPending={busy === "unpublishing"}
        onConfirm={() => doUnpublish(false)}
      />
      <ReferencedDialog
        open={referenced !== null}
        onOpenChange={(open) => !open && setReferenced(null)}
        noun={noun}
        variant={resource === "albums" || resource === "faq-groups" ? "used" : "link"}
        items={referenced?.items ?? []}
        total={referenced?.total ?? 0}
        isPending={busy === "unpublishing"}
        onConfirm={() => doUnpublish(true)}
      />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t("discard.title")}
        description={t("discard.description", { noun })}
        confirmLabel={t("discard.confirm")}
        destructive
        isPending={busy === "discarding"}
        onConfirm={doDiscard}
      />
      <ScheduleDialog
        open={scheduleDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setScheduleDialog(null);
            setScheduleProblem(null);
          }
        }}
        mode={scheduleDialog?.mode ?? "schedule"}
        noun={noun}
        warnings={scheduleDialog?.warnings ?? []}
        currentRunAt={schedule?.run_at ?? null}
        isPending={busy === "scheduling"}
        problem={scheduleProblem}
        onClearProblem={() => setScheduleProblem(null)}
        onConfirm={doSchedule}
      />
      <SubmitReviewDialog open={submitOpen} onOpenChange={setSubmitOpen} noun={noun} isPending={busy === "submitting"} onConfirm={doSubmit} />
      <RejectDialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open);
          if (!open) setRejectProblem(null);
        }}
        noun={noun}
        isPending={busy === "rejecting"}
        problem={rejectProblem}
        onClearProblem={() => setRejectProblem(null)}
        onConfirm={doReject}
      />
      <ConfirmDialog
        open={cancelScheduleOpen}
        onOpenChange={setCancelScheduleOpen}
        title={t("schedule.cancel.title", { noun })}
        description={t(status === "published" ? "schedule.cancel.descriptionChanges" : entity.first_published_at ? "schedule.cancel.descriptionArchived" : "schedule.cancel.descriptionDraft", { noun })}
        confirmLabel={t("schedule.cancel.confirm")}
        isPending={busy === "unscheduling"}
        onConfirm={doUnschedule}
      />
      <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} onReload={reload} isReloading={isReloading} />
    </TooltipProvider>
  );
}
