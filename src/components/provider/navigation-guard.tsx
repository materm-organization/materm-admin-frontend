"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// Unsaved-changes guard for the protected area (doc/07 section 2.5.5). The App Router has no route-change
// event, so three things are covered:
//  1. closing / reloading the tab -> the browser's `beforeunload` prompt;
//  2. in-app navigation -> a capture-phase click listener on same-origin `<a href>` (sidebar, breadcrumb,
//     any `next/link`) and `guardedNavigate(fn)` for programmatic moves (`router.push`, "back" buttons);
//  3. the browser Back button -> `popstate`, BEST EFFORT: while a form is dirty one extra history entry is
//     pushed, so Back lands on the same page and asks first. After the form becomes clean again that spare
//     entry remains (one extra Back press stays on the page).
// A page registers its dirty state with `useUnsavedChangesGuard(isDirty, { onSave })`
// (hooks/use-unsaved-changes-guard.ts). Dirty = RHF `formState.isDirty`, or a local order not yet `PUT`.

type GuardEntry = { onSave?: () => Promise<boolean | void> | boolean | void };

type NavigationGuardContextValue = {
  register: (id: string, entry: GuardEntry) => () => void;
  update: (id: string, entry: GuardEntry) => void;
  // Runs `proceed` now when nothing is dirty, otherwise after the user chose to discard (or saved).
  guardedNavigate: (proceed: () => void) => void;
  isDirty: boolean;
};

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

// Outside a provider (a unit test, an auth page) the guard is a no-op: navigation always proceeds.
const NOOP: NavigationGuardContextValue = {
  register: () => () => {},
  update: () => {},
  guardedNavigate: (proceed) => proceed(),
  isDirty: false,
};

export function useNavigationGuardContext(): NavigationGuardContextValue {
  return useContext(NavigationGuardContext) ?? NOOP;
}

// `guardedNavigate(() => router.push(href))` for programmatic navigation (a "back" button, after "create").
export function useGuardedNavigate() {
  return useNavigationGuardContext().guardedNavigate;
}

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("dialogs.unsavedChanges");
  const router = useRouter();
  const entries = useRef(new Map<string, GuardEntry>());
  const [guard, setGuard] = useState({ isDirty: false, canSave: false });
  const { isDirty, canSave } = guard;
  const [pending, setPending] = useState<{ proceed: () => void; fromHistory: boolean } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  // True while a confirmed navigation is under way, so our own listeners let it through.
  const bypass = useRef(false);

  // `isDirty` / `canSave` are state (derived from the registry below) so rendering never reads the ref.
  const sync = useCallback(() => {
    const all = [...entries.current.values()];
    const next = { isDirty: all.length > 0, canSave: all.some((e) => e.onSave) };
    setGuard((prev) =>
      prev.isDirty === next.isDirty && prev.canSave === next.canSave ? prev : next
    );
  }, []);

  const register = useCallback(
    (id: string, entry: GuardEntry) => {
      entries.current.set(id, entry);
      sync();
      return () => {
        entries.current.delete(id);
        sync();
      };
    },
    [sync]
  );

  const update = useCallback(
    (id: string, entry: GuardEntry) => {
      if (!entries.current.has(id)) return;
      entries.current.set(id, entry);
      sync();
    },
    [sync]
  );

  const guardedNavigate = useCallback((proceed: () => void) => {
    if (entries.current.size === 0 || bypass.current) {
      proceed();
      return;
    }
    setPending({ proceed, fromHistory: false });
  }, []);

  const leave = useCallback((proceed: () => void) => {
    bypass.current = true;
    setPending(null);
    proceed();
    // The page that was dirty unmounts with the navigation; if it did not (same route), re-arm.
    window.setTimeout(() => {
      bypass.current = false;
    }, 500);
  }, []);

  // 1. Tab close / reload.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // 2. Clicks on same-origin links (capture phase: runs before React / next/link see the click).
  useEffect(() => {
    if (!isDirty) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || bypass.current) return;
      if (anchor.hasAttribute("download")) return;
      const frame = anchor.getAttribute("target");
      if (frame && frame !== "_self") return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // Another origin leaves the app: `beforeunload` asks.
      if (url.origin !== window.location.origin) return;
      // Same document, only the hash differs.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const href = `${url.pathname}${url.search}${url.hash}`;
      guardedNavigate(() => router.push(href));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [isDirty, guardedNavigate, router]);

  // 3. Browser Back (best effort, see the header comment).
  useEffect(() => {
    if (!isDirty) return;
    // Spare entry carrying Next's own history state (it only accepts pushState with that state intact).
    window.history.pushState(window.history.state, "", window.location.href);
    const onPopState = () => {
      if (bypass.current) return;
      // We are back on the real entry; ask, and re-arm the trap if the user stays.
      setPending({ proceed: () => window.history.back(), fromHistory: true });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isDirty]);

  const stay = () => {
    const wasHistory = pending?.fromHistory === true;
    setPending(null);
    // After a Back press the spare entry was consumed: push another so the next Back asks again.
    if (wasHistory && isDirty) {
      window.history.pushState(window.history.state, "", window.location.href);
    }
  };

  const saveAndLeave = async () => {
    if (!pending) return;
    const savers = [...entries.current.values()].filter((e) => e.onSave);
    setSaving(true);
    try {
      for (const entry of savers) {
        const result = await entry.onSave?.();
        if (result === false) return; // a save refused (validation): stay on the page
      }
      leave(pending.proceed);
    } catch {
      // The saver reports its own error; stay.
    } finally {
      setSaving(false);
    }
  };

  const value = useMemo(
    () => ({ register, update, guardedNavigate, isDirty }),
    [register, update, guardedNavigate, isDirty]
  );

  return (
    <NavigationGuardContext.Provider value={value}>
      {children}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && !saving && stay()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("stay")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                if (pending) leave(pending.proceed);
              }}
            >
              {t("discard")}
            </AlertDialogAction>
            {canSave ? (
              <Button type="button" disabled={saving} onClick={() => void saveAndLeave()}>
                {saving ? <Spinner /> : null}
                {t("saveAndLeave")}
              </Button>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </NavigationGuardContext.Provider>
  );
}
