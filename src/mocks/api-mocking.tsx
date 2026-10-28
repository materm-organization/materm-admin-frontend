"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// `NEXT_PUBLIC_API_MOCKING=true` (a build-time constant, set on the command line of a scratch clone - never in an
// `.env` file) answers the admin's API calls from the in-memory model of `src/mocks/`, so the screens whose
// endpoints do not exist yet can be clicked through. Without the flag this renders its children untouched and the
// bundler drops the dynamic import (and with it msw and the fixtures) from the build.
const Mocked =
  process.env.NEXT_PUBLIC_API_MOCKING === "true"
    ? dynamic(() => import("@/mocks/api-mocking-impl"), { ssr: false })
    : null;

export function ApiMocking({ children }: { children: ReactNode }) {
  if (Mocked) return <Mocked>{children}</Mocked>;
  return <>{children}</>;
}
