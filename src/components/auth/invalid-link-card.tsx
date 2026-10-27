import { LinkIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// "This link is invalid or has expired" state shared by SCR-03 / SCR-04 (one message for every cause: unknown,
// used, expired — the server does not tell them apart either).
export function InvalidLinkCard({
  title,
  description,
  actionHref,
  actionLabel,
  secondary,
}: {
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
  secondary?: ReactNode;
}) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <LinkIcon className="size-5 text-destructive" aria-hidden />
          {title}
        </CardTitle>
        <CardDescription role="alert">{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Button asChild className="w-full">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
        {secondary}
      </CardContent>
    </Card>
  );
}
