"use client";

import { useCallback, useSyncExternalStore } from "react";

// The grid / list choice of the media library is a per-browser preference (not part of the shareable URL, doc/07
// 2.5.1 keeps the URL for list state). `localStorage` may be missing or throw (private window): then it just
// stays "grid". `useSyncExternalStore` keeps server and first client render equal ("grid") and switches after.
export type MediaView = "grid" | "list";
const KEY = "materm-admin:media-view";
const listeners = new Set<() => void>();
// Used when storage is unavailable, so the toggle still works for the page's lifetime.
let memory: MediaView | null = null;

function read(): MediaView {
  try {
    return window.localStorage.getItem(KEY) === "list" ? "list" : "grid";
  } catch {
    return memory ?? "grid";
  }
}

export function useMediaView(): [MediaView, (view: MediaView) => void] {
  const view = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      window.addEventListener("storage", listener);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },
    read,
    () => "grid" as MediaView
  );
  const setView = useCallback((next: MediaView) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* private window: the choice lasts until reload */
      memory = next;
    }
    listeners.forEach((l) => l());
  }, []);
  return [view, setView];
}
