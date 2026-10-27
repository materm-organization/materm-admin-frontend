"use client";

import { useEffect, useRef, useState } from "react";

import { consumeFragmentToken } from "@/lib/url-token";

export type FragmentToken =
  // Not read yet (server render / first client render): render a neutral spinner, not an error.
  | { status: "pending"; token: null }
  | { status: "missing"; token: null }
  | { status: "ready"; token: string };

// Reads the one-time token from the URL fragment ONCE, in an effect (not during render: no hydration mismatch),
// and removes it from the address bar immediately. The `consumed` ref survives React Strict Mode's second
// effect run in `next dev` (which would otherwise find the fragment already gone and report "missing").
export function useFragmentToken(): FragmentToken {
  const consumed = useRef(false);
  const [state, setState] = useState<FragmentToken>({ status: "pending", token: null });

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    const token = consumeFragmentToken();
    // One-time init from an external system (the URL) — an effect is the right place for it.
    setState(token ? { status: "ready", token } : { status: "missing", token: null });
  }, []);

  return state;
}
