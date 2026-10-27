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
  dialog incl. the non-dismissable `forced` mode), `src/hooks/use-auth.ts` (current user,
  `useHasAction`, login, logout, change password), `src/services/auth.api.ts`,
  `src/lib/auth-session.ts` (cookies), `src/lib/api-error*.ts` + `src/hooks/use-api-error.ts`
  (error `code` -> i18n), `src/types/user.d.ts`. Contract: `../doc/05-api-spec.md` (§1–2).
- **Users (P0d)** — `/admin/users` (`src/components/protected/users/`, `src/hooks/use-users.ts`,
  `src/services/users.api.ts`): list + create with `delivery=temporary_password`; the one-time
  password is shown in a dialog and never stored.
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

## Auth / permission rules (P0d, matches doc/05)

- `lib/axios.ts`: ONE shared `GET /jwt/refresh` for concurrent 401s (`UNAUTHENTICATED`,
  `TOKEN_EXPIRED`, `AUTHZ_CHANGED`), rotated pair stored, each request retried once. 401
  `SESSION_REVOKED` / `REFRESH_REUSED` / `REFRESH_REPLAY_UNAVAILABLE` or a 401 from the refresh
  call -> clear session + hard redirect to sign-in. **403 and 429 never sign out or redirect**;
  `QueryProvider` toasts them (and network/5xx) once, forms handle 400/404/409/422 themselves
  (`useApiErrorHandler`). Decide on the error `code`, never on `message`.
- Error text: `errors.codes.<CODE>` / `errors.fields.<field code>` in `i18n/*.json` (field codes with a
  dot are nested JSON). Field errors (`errors[]`, JSON-Pointer `path`) are mapped onto form fields.
- `must_change_password` (from `/auth/me`) or a 403 `PASSWORD_CHANGE_REQUIRED` -> the guard renders only
  the forced change-password dialog until it is cleared.
- `actions: []` / missing key = NO access (`userHasAction`, `useHasAction`). Routes/nav need `read`
  (`getReadablePermissionKeys`). `NEXT_PUBLIC_DISABLE_AUTH_GUARD=true` (dev) gives a bypass user with all
  22 keys / 15 actions (`lib/constants/permissions.ts`, mirror of the backend catalog seed).
- Not built yet: `If-Match`/ETag handling for `PATCH /users/{id}` and `PUT /roles/{id}/permissions`
  (mandatory for the latter) — add it with the roles/users edit UI.
