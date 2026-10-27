"use client";

import { useState } from "react";

import { newIdempotencyKey } from "@/lib/idempotency";

// One key per "open" of a dialog/form: a new key is created whenever `open` turns true (derived during render,
// no effect), the same key is used for every submit while it stays open, so a retry is an idempotent replay.
export function useIdempotencyKey(open: boolean): string {
  const [state, setState] = useState<{ open: boolean; key: string }>(() => ({
    open,
    key: newIdempotencyKey(),
  }));
  if (state.open !== open) {
    setState({ open, key: open ? newIdempotencyKey() : state.key });
  }
  return state.key;
}
