"use client";

import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useId, useMemo } from "react";

import {
  type Matrix,
  columnState,
  groupByCategory,
  rowState,
  toggleAction,
  toggleCategoryFull,
  toggleColumn,
  toggleRowFull,
} from "@/components/protected/roles/matrix-model";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ActionDef, RolePermission } from "@/types/iam";

// The role permission matrix (SCR-10, doc/07 section 3.5), built for quick work instead of 330 loose boxes:
//  - one row per feature (22 keys), grouped by category; each row has a "full access / none" switch;
//  - each category has a tri-state box that fills / clears all of its rows; each action column has a box that
//    adds / removes that action on every row that has it (and `read` with it);
//  - individual boxes only for fine tuning. A cell the key does not offer is a dot (BR-23);
//  - every box except `read` stays DISABLED until `read` of the row is ticked (BR-22); unticking `read`
//    clears the row. `readOnly` (the super role, or no `iam.roles:update`) disables everything.
// Controlled: the parent owns the matrix (and the diff / save).
export function PermissionMatrix({
  permissions,
  actions,
  matrix,
  onChange,
  readOnly = false,
  rowErrors = {},
}: {
  permissions: readonly RolePermission[];
  // The 15 actions in column order, with the descriptions used as header tooltips.
  actions: readonly ActionDef[];
  matrix: Matrix;
  onChange: (next: Matrix) => void;
  readOnly?: boolean;
  // Server errors per permission key (422 `/grants/{n}/…` mapped back to the row).
  rowErrors?: Record<string, string>;
}) {
  const t = useTranslations("roles.matrix");
  const tCat = useTranslations("roles.categories");
  const tAct = useTranslations("roles.actionLabels");
  const hintId = useId();
  const order = useMemo(() => actions.map((a) => a.action), [actions]);
  const groups = useMemo(() => groupByCategory(permissions), [permissions]);
  const label = (action: string) => (tAct.has(action) ? tAct(action) : action);
  const categoryLabel = (category: string) => (tCat.has(category) ? tCat(category) : category);

  const setRow = (key: string, row: string[]) => onChange({ ...matrix, [key]: row });

  return (
    <div className="space-y-2">
      <p id={hintId} className="text-sm text-muted-foreground">
        {readOnly ? t("hintReadOnly") : t("hint")}
      </p>
      <div className="overflow-x-auto rounded-md border" data-testid="permission-matrix">
        <table className="w-full min-w-[960px] border-collapse text-sm" aria-describedby={hintId}>
          <thead>
            <tr className="border-b bg-muted/50 text-xs">
              <th scope="col" className="sticky left-0 z-10 min-w-56 bg-muted px-3 py-2 text-left font-medium">
                {t("feature")}
              </th>
              <th scope="col" className="w-24 px-2 py-2 text-center font-medium">
                {t("fullAccess")}
              </th>
              {actions.map((a) => {
                const state = columnState(matrix, permissions, a.action);
                return (
                  <th key={a.action} scope="col" className="px-1 py-2 text-center font-medium" title={a.description}>
                    <div className="flex flex-col items-center gap-1">
                      <span>{label(a.action)}</span>
                      {state === "unavailable" ? null : (
                        <Checkbox
                          aria-label={t("columnAll", { action: label(a.action) })}
                          checked={state === "all" ? true : state === "some" ? "indeterminate" : false}
                          disabled={readOnly}
                          onCheckedChange={() => onChange(toggleColumn(matrix, permissions, a.action, order))}
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const states = group.permissions.map((p) => rowState(matrix[p.permission_key] ?? [], p.available_actions));
              const catState = states.every((s) => s === "full") ? "full" : states.every((s) => s === "none") ? "none" : "partial";
              return (
                <Fragment key={group.category}>
                  <tr className="border-b bg-muted/30">
                    <th scope="rowgroup" colSpan={2} className="sticky left-0 z-10 bg-muted px-3 py-1.5 text-left text-xs font-semibold tracking-wide uppercase">
                      <span className="flex items-center gap-2">
                        <Checkbox
                          aria-label={t("categoryAll", { category: categoryLabel(group.category) })}
                          checked={catState === "full" ? true : catState === "partial" ? "indeterminate" : false}
                          disabled={readOnly}
                          onCheckedChange={() => onChange(toggleCategoryFull(matrix, group.permissions, order))}
                        />
                        {categoryLabel(group.category)}
                      </span>
                    </th>
                    <td colSpan={actions.length} className="bg-muted/30" />
                  </tr>
                  {group.permissions.map((p) => {
                    const row = matrix[p.permission_key] ?? [];
                    const state = rowState(row, p.available_actions);
                    const hasRead = row.includes("read");
                    const error = rowErrors[p.permission_key];
                    return (
                      <Fragment key={p.permission_key}>
                        <tr
                          className={cn("border-b hover:bg-muted/20", error && "bg-destructive/5")}
                          data-testid={`row-${p.permission_key}`}
                        >
                          <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-1.5 text-left font-normal" title={p.description}>
                            <div className="font-medium">{p.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {p.permission_key}
                              {row.length > 0 ? ` · ${row.length}/${p.available_actions.length}` : ""}
                            </div>
                          </th>
                          <td className="px-2 py-1.5 text-center">
                            <Switch
                              aria-label={t("rowFull", { name: p.name })}
                              checked={state === "full"}
                              disabled={readOnly}
                              onCheckedChange={() => setRow(p.permission_key, toggleRowFull(row, p.available_actions, order))}
                            />
                          </td>
                          {actions.map((a) => {
                            if (!p.available_actions.includes(a.action)) {
                              return (
                                <td key={a.action} className="px-1 py-1.5 text-center text-muted-foreground">
                                  <span aria-hidden>·</span>
                                  <span className="sr-only">{t("notAvailable", { action: label(a.action) })}</span>
                                </td>
                              );
                            }
                            const locked = a.action !== "read" && !hasRead;
                            return (
                              <td key={a.action} className="px-1 py-1.5 text-center">
                                <Checkbox
                                  aria-label={`${p.name}: ${label(a.action)}`}
                                  title={locked ? t("needsRead") : undefined}
                                  checked={row.includes(a.action)}
                                  disabled={readOnly || locked}
                                  onCheckedChange={() =>
                                    setRow(p.permission_key, toggleAction(row, a.action, p.available_actions, order))
                                  }
                                />
                              </td>
                            );
                          })}
                        </tr>
                        {error ? (
                          <tr className="border-b bg-destructive/5">
                            <td colSpan={actions.length + 2} className="px-3 py-1 text-xs text-destructive" role="alert">
                              {p.name}: {error}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {readOnly ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <LockIcon className="size-3" aria-hidden />
          {t("lockedNote")}
        </p>
      ) : null}
    </div>
  );
}
