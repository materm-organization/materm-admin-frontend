"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

// Lets a detail page name the last breadcrumb level (doc/07 section 2.4): "Users › somchai" instead of the
// config's "Users". The page calls `useBreadcrumbTitle(user?.name)` — `undefined` while loading (the header
// shows a skeleton), the real name afterwards; the level disappears when the page unmounts.
//
// A tiny external store (not React state) so a page can set the title from an effect without a cascading render.

type Detail = { title: string | undefined } | null;

type BreadcrumbStore = {
  get: () => Detail;
  set: (detail: Detail) => void;
  subscribe: (listener: () => void) => () => void;
};

function createStore(): BreadcrumbStore {
  let detail: Detail = null;
  const listeners = new Set<() => void>();
  return {
    get: () => detail,
    set: (next) => {
      if (next === null && detail === null) return;
      if (next && detail && next.title === detail.title) return;
      detail = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const BreadcrumbContext = createContext<BreadcrumbStore | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore);
  return <BreadcrumbContext.Provider value={store}>{children}</BreadcrumbContext.Provider>;
}

// For the header: the title a detail page set, or `null`.
export function useBreadcrumbDetail(): Detail {
  const store = useContext(BreadcrumbContext);
  return useSyncExternalStore(
    (listener) => (store ? store.subscribe(listener) : () => {}),
    () => (store ? store.get() : null),
    () => null
  );
}

// For a detail page: pass the item's name (`undefined` while loading). Outside a provider it does nothing.
export function useBreadcrumbTitle(title: string | null | undefined) {
  const store = useContext(BreadcrumbContext);
  useEffect(() => {
    if (!store) return;
    // `null` = "this page names nothing" (e.g. a 404): no extra level.
    store.set(title === null ? null : { title });
  }, [store, title]);
  useEffect(() => () => store?.set(null), [store]);
}
