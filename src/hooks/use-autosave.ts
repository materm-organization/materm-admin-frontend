"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Autosave for the section / publishable editors (doc/07 section 2.5.8, FR-PUB-07, C-34, Q-07-7).
//
// OFF by default (decision: the user opts in, per browser). When `enabled`, a save is attempted `delayMs`
// (30 s) after the form becomes dirty and valid enough to save (`blocked` = a structural problem that the
// server would refuse, or a conflict dialog is open):
//   strategy "debounce" (default): the timer restarts on every change (`changeToken` changes) and fires after a
//     30 s pause in editing;
//   strategy "interval": the timer starts at the first edit and is NOT pushed back by further typing, so a long
//     editing session is saved every 30 s (the wording of FR-PUB-07 / doc/07 C-34 - choose it if the user wants that).
// `save` is the editor's own save (PATCH with If-Match); it must resolve when saved and throw / reject on
// failure (status "error", retried at the next tick). Nothing here talks to the network.
export type AutosaveStatus = "idle" | "scheduled" | "saving" | "saved" | "error";

export function useAutosave({
  enabled,
  isDirty,
  blocked = false,
  save,
  delayMs = 30_000,
  strategy = "debounce",
  changeToken,
}: {
  enabled: boolean;
  isDirty: boolean;
  blocked?: boolean;
  save: () => Promise<unknown> | unknown;
  delayMs?: number;
  strategy?: "debounce" | "interval";
  // Debounce (default): any value that changes with the form (the props object).
  changeToken?: unknown;
}) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveRef = useRef(save);
  const savingRef = useRef(false);
  useEffect(() => {
    saveRef.current = save;
  });

  const run = useCallback(async () => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setStatus("saving");
    try {
      await saveRef.current();
      setLastSavedAt(new Date());
      setStatus("saved");
      return true;
    } catch {
      setStatus("error");
      return false;
    } finally {
      savingRef.current = false;
    }
  }, []);

  const eligible = enabled && isDirty && !blocked;
  const token = strategy === "debounce" ? changeToken : undefined;
  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => {
      void run();
    }, delayMs);
    return () => clearTimeout(timer);
    // `token` restarts the timer only in debounce mode; `status` re-arms it after a save (edits made while
    // saving) and after a failure (retry at the next tick).
  }, [eligible, delayMs, run, token, status]);

  // "scheduled" is derived: waiting for the timer. It never needs its own state update.
  const shown: AutosaveStatus = status === "saving" || status === "error" ? status : eligible ? "scheduled" : status;
  return { status: shown, lastSavedAt, saveNow: run };
}

const STORAGE_KEY = "materm-admin:autosave";

// The user's own switch (a per-viewer convenience, so browser storage is right for it). OFF unless they turned it on.
export function readAutosavePreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeAutosavePreference(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* storage can be blocked (private window); the preference then lasts for the session only */
  }
}

const preferenceListeners = new Set<() => void>();

function subscribePreference(listener: () => void) {
  preferenceListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    preferenceListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useAutosavePreference() {
  // The server render and the first client render both say "off" (no hydration mismatch); the stored choice
  // is read right after.
  const enabled = useSyncExternalStore(subscribePreference, readAutosavePreference, () => false);
  const update = useCallback((on: boolean) => {
    writeAutosavePreference(on);
    preferenceListeners.forEach((listener) => listener());
  }, []);
  return [enabled, update] as const;
}
