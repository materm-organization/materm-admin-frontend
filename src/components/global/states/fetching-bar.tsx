// "Refetching": a thin 2 px indeterminate bar on top of a card while `isFetching && !isLoading` — the previous
// data stays visible (`placeholderData: keepPreviousData`). Purely visual (`aria-hidden`).
export function FetchingBar({ active }: { active: boolean }) {
  return (
    <div className="relative h-0.5 w-full overflow-hidden" aria-hidden>
      {active ? <div className="absolute inset-y-0 w-1/3 animate-pulse bg-primary" /> : null}
    </div>
  );
}
