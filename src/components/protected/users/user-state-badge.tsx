"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { UserState } from "@/types/iam";

const STATE_VARIANT: Record<UserState, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  invited: "outline",
  disabled: "secondary",
  locked: "destructive",
};

export function UserStateBadge({ state }: { state: UserState }) {
  const t = useTranslations("users.state");
  return <Badge variant={STATE_VARIANT[state] ?? "outline"}>{t.has(state) ? t(state) : state}</Badge>;
}
