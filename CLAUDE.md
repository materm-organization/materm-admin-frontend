# CLAUDE.md

This file provides guidance to Claude Code when working on this project.

## What this is

`materm-admin-frontend` (Materm Admin) — a Next.js 16 App Router admin/back-office panel:
auth, a protected layout shell, and shared infrastructure only. It has no backend of its own
and no business domain yet.

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript |
| Server state | TanStack React Query |
| Client-only state | Redux Toolkit (one small `ui` slice) |
| HTTP | axios (`src/lib/axios.ts` — one authenticated + one public instance) |
| Forms | react-hook-form + zod |
| UI kit | shadcn/ui ("new-york" style) + Tailwind v4 |
| i18n | next-intl, cookie-based locale (`la` default, `en`) — no `[locale]` route segment |
| Auth | JWT in cookies (`js-cookie`), client-side `(protected)` route-group guard, no edge middleware |

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
npm run build
npm run lint
```

Env vars: `.env.development` / `.env.production`, both `NEXT_PUBLIC_API_BASE_URL` only — no
secrets in this layer.

## Current scope

This project is at its initial skeleton stage. What exists:

- **Auth** — `src/app/auth/sign-in/`, `src/components/auth/` (sign-in form, change-password
  dialog), `src/hooks/use-auth.ts`, `src/services/auth.api.ts`, `src/types/user.d.ts`
  (login / current-user / change-password shapes only).
- **Protected shell** — `src/app/(protected)/(routes)/layout.tsx` (sidebar + header +
  `RoutePermissionGuard`), `src/components/navbar/`, `src/components/layout/`,
  `src/lib/nav-main-items.ts` (permission-driven nav config), `src/lib/constants/breadcrumb.ts`.
- **Placeholder landing page** — `src/app/(protected)/(routes)/admin/page.tsx` (empty dashboard).
  Post-login redirect and `/` -> `/auth/sign-in` both land here via the guard.
- **Shared infrastructure** — `src/components/ui/` (shadcn primitives), `src/components/global/`
  (data table, pagination, filters, empty state, export-csv dialog, theme/language toggles),
  `src/components/provider/`, `src/lib/axios.ts` (authenticated + public instance, token refresh),
  `src/lib/constants/`, `src/redux/` (store + one small `ui` slice), `src/i18n/request.ts`,
  `i18n/{en,la}.json` (only `common`, `changePassword`, `auth`, `nav`, `breadcrumb`, `dashboard`).

There are **no business modules** yet. To add one, follow the feature-vertical pattern:
`src/app/(protected)/(routes)/admin/<feature>/page.tsx` + `src/services/<feature>.api.ts` +
`src/hooks/use-<feature>.ts` + `src/types/<feature>.d.ts` + `src/components/protected/<feature>/`,
add its endpoints to `src/lib/constants/api-endpoints.ts`, a nav entry in
`src/lib/nav-main-items.ts`, a breadcrumb entry in `src/lib/constants/breadcrumb.ts`, and its
i18n namespace in both `i18n/en.json` and `i18n/la.json`.

Auth endpoint paths (`/login`, `/auth/me`, `/jwt/refresh`, `/auth/users/change-password`) and
payload shapes are placeholders — adjust them to the real Materm backend.
`NEXT_PUBLIC_DISABLE_AUTH_GUARD=true` in `.env.development` bypasses login and the guard (dev only).
