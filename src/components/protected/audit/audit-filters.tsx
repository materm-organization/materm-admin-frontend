"use client";

import { format as formatDate } from "date-fns";
import { FilterIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { DateRangeFilter } from "@/components/global/date-range-filter";
import {
  type AuditFilterValues,
  MAX_RANGE_DAYS_BROAD,
  MAX_RANGE_MONTHS_NARROW,
  checkAuditRange,
} from "@/components/protected/audit/audit-range";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUsers } from "@/hooks/use-users";
import { useCan } from "@/hooks/use-permission";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";

const ANY = "__any__";
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;
const ENTITY_TYPE = /^[a-z_]+(\.[a-z_]+)*$/;

type Draft = {
  actor_id: string;
  actor_type: string;
  action: string;
  result: string;
  entity_type: string;
  entity_id: string;
  request_id: string;
  range: { from: Date; to: Date } | undefined;
};

const parseDay = (ymd?: string) => {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
};

function toDraft(f: AuditFilterValues): Draft {
  const from = parseDay(f.from);
  const to = parseDay(f.to);
  return {
    actor_id: f.actor_id ? String(f.actor_id) : "",
    actor_type: f.actor_type ?? "",
    action: f.action ?? "",
    result: f.result ?? "",
    entity_type: f.entity_type ?? "",
    entity_id: f.entity_id ? String(f.entity_id) : "",
    request_id: f.request_id ?? "",
    range: from && to ? { from, to } : from ? { from, to: from } : to ? { from: to, to } : undefined,
  };
}

// The filter form of SCR-11. The draft is local; "Apply" commits ALL fields to the URL in one step (one
// history entry, page 1). Nothing outside the endpoint's allow-list is offered (no keyword). The range rules of
// doc/05 section 5.1 are checked before applying. Mount it keyed by the URL filters so a changed URL reseeds it.
export function AuditFilters({
  filters,
  onApply,
}: {
  filters: AuditFilterValues;
  onApply: (next: AuditFilterValues) => void;
}) {
  const t = useTranslations("audit.filters");
  const idPrefix = useId();
  const canReadUsers = useCan(PERMISSION_KEYS.IAM_USERS, PERMISSION_ACTIONS.READ);
  // Only with `iam.users:read`: otherwise nothing is requested (a 403 is an audited event) and the id is typed.
  const users = useUsers({ limit: 100, sort: "name" }, canReadUsers);
  const [draft, setDraft] = useState<Draft>(() => toDraft(filters));
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const selectOrAny = (v: string) => (v === ANY ? "" : v);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const next: AuditFilterValues = {
      actor_id: draft.actor_id ? Number(draft.actor_id) : undefined,
      actor_type: draft.actor_type || undefined,
      action: draft.action.trim() || undefined,
      result: draft.result || undefined,
      entity_type: draft.entity_type.trim() || undefined,
      entity_id: draft.entity_id ? Number(draft.entity_id) : undefined,
      request_id: draft.request_id.trim() || undefined,
      from: draft.range ? formatDate(draft.range.from, "yyyy-MM-dd") : undefined,
      to: draft.range ? formatDate(draft.range.to, "yyyy-MM-dd") : undefined,
    };
    if (next.actor_id !== undefined && !(Number.isInteger(next.actor_id) && next.actor_id > 0)) {
      return setError(t("errors.actorId"));
    }
    if (next.entity_id !== undefined && !(Number.isInteger(next.entity_id) && next.entity_id > 0)) {
      return setError(t("errors.entityId"));
    }
    if (next.entity_id !== undefined && !next.entity_type) return setError(t("errors.entityPair"));
    if (next.entity_type && !ENTITY_TYPE.test(next.entity_type)) return setError(t("errors.entityType"));
    if (next.request_id && !REQUEST_ID.test(next.request_id)) return setError(t("errors.requestId"));
    if (next.action && next.action.split(",").filter(Boolean).length > 10) return setError(t("errors.actionCount"));
    const range = checkAuditRange(next);
    if (!range.ok) {
      return setError(
        range.max === "days"
          ? t("errors.rangeBroad", { days: MAX_RANGE_DAYS_BROAD })
          : t("errors.rangeNarrow", { months: MAX_RANGE_MONTHS_NARROW })
      );
    }
    setError(null);
    onApply(next);
  };

  const field = (name: string) => `${idPrefix}-${name}`;
  // The same range rule, shown for what is in the URL right now (a shared link can break it).
  const urlRange = checkAuditRange(filters);

  return (
    <form onSubmit={apply} className="w-full space-y-2" aria-label={t("form")}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t("range")}</Label>
          <DateRangeFilter
            label={t("range")}
            dateRange={draft.range}
            setDateRange={(v) => set("range", typeof v === "function" ? v(draft.range) : v)}
          />
          {!draft.range ? <p className="text-[11px] text-muted-foreground">{t("rangeDefault")}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor={field("actor")} className="text-xs">
            {t("actor")}
          </Label>
          {canReadUsers && !users.isError ? (
            <Select value={draft.actor_id || ANY} onValueChange={(v) => set("actor_id", selectOrAny(v))}>
              <SelectTrigger id={field("actor")} size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t("any")}</SelectItem>
                {(users.data?.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name} ({u.username})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={field("actor")}
              inputMode="numeric"
              placeholder={t("actorIdPlaceholder")}
              className="h-8 w-32"
              value={draft.actor_id}
              onChange={(e) => set("actor_id", e.target.value)}
            />
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor={field("actorType")} className="text-xs">
            {t("actorType")}
          </Label>
          <Select value={draft.actor_type || ANY} onValueChange={(v) => set("actor_type", selectOrAny(v))}>
            <SelectTrigger id={field("actorType")} size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("any")}</SelectItem>
              {(["user", "api_key", "system", "public"] as const).map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`actorTypes.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={field("result")} className="text-xs">
            {t("result")}
          </Label>
          <Select value={draft.result || ANY} onValueChange={(v) => set("result", selectOrAny(v))}>
            <SelectTrigger id={field("result")} size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("any")}</SelectItem>
              {(["success", "denied", "error"] as const).map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`results.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={field("action")} className="text-xs">
            {t("action")}
          </Label>
          <Input
            id={field("action")}
            className="h-8 w-56 font-mono text-xs"
            placeholder={t("actionPlaceholder")}
            value={draft.action}
            onChange={(e) => set("action", e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={field("entityType")} className="text-xs">
            {t("entityType")}
          </Label>
          <Input
            id={field("entityType")}
            className="h-8 w-40 font-mono text-xs"
            placeholder="iam.user"
            value={draft.entity_type}
            onChange={(e) => set("entity_type", e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={field("entityId")} className="text-xs">
            {t("entityId")}
          </Label>
          <Input
            id={field("entityId")}
            inputMode="numeric"
            className="h-8 w-24"
            value={draft.entity_id}
            onChange={(e) => set("entity_id", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={field("requestId")} className="text-xs">
            {t("requestId")}
          </Label>
          <Input
            id={field("requestId")}
            className="h-8 w-60 font-mono text-xs"
            value={draft.request_id}
            onChange={(e) => set("request_id", e.target.value)}
            spellCheck={false}
          />
        </div>
        <Button type="submit" size="sm">
          <FilterIcon />
          {t("apply")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!urlRange.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {urlRange.max === "days"
            ? t("errors.rangeBroad", { days: MAX_RANGE_DAYS_BROAD })
            : t("errors.rangeNarrow", { months: MAX_RANGE_MONTHS_NARROW })}
        </p>
      ) : null}
    </form>
  );
}
