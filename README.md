# Materm Admin

Materm Admin frontend (`materm-admin-frontend`) — a Next.js 16 App Router admin panel: sign-in/auth flow, a protected layout
shell (sidebar + header + permission-aware route guard), i18n, theming, and a shared
component library — with **no business modules yet**. Add features on top.

## What is included

- `src/app/auth/sign-in` — public sign-in page; `src/components/auth` — sign-in form and
  change-password dialog; `src/hooks/use-auth.ts` + `src/services/auth.api.ts` — login,
  current user, change password.
- `src/app/(protected)/(routes)` — client-side guarded layout (sidebar, header, route
  permission guard) with a placeholder landing page at `/admin`.
- `src/components/ui` (shadcn/ui, "new-york" + Tailwind v4), `src/components/global`
  (data table, pagination, filters, empty state, export dialog, theme/language toggles).
- `src/lib/axios.ts` (authenticated + public axios instances, token refresh),
  `src/redux` (store + small `ui` slice), React Query provider, next-intl (cookie-based
  locale: `la` default, `en`; messages in `i18n/*.json`).

## Running it

```bash
npm install
npm run dev     # http://localhost:3000
npm run build
npm run lint
```

`.env.development` sets `NEXT_PUBLIC_DISABLE_AUTH_GUARD=true`, which skips the login and
route-guard check so `/admin` renders without a backend (see `hooks/use-auth.ts`'s
`DEV_BYPASS_AUTH`) — dev-only, never set it in `.env.production`. Otherwise point
`NEXT_PUBLIC_API_BASE_URL` at your backend and adjust the auth endpoint paths in
`src/lib/constants/api-endpoints.ts` and payload shapes in `src/types/user.d.ts`.

## Adding a feature

Add a page under `src/app/(protected)/(routes)/admin/<feature>/`, plus
`src/services/<feature>.api.ts`, `src/hooks/use-<feature>.ts`, `src/types/<feature>.d.ts`
and `src/components/protected/<feature>/`. Register its endpoints in
`src/lib/constants/api-endpoints.ts`, its nav entry in `src/lib/nav-main-items.ts`, its
breadcrumb in `src/lib/constants/breadcrumb.ts`, and its i18n namespace in both
`i18n/en.json` and `i18n/la.json`.

## Learn more

- [Next.js Documentation](https://nextjs.org/docs)
- [next-intl Documentation](https://next-intl.dev)
- [shadcn/ui](https://ui.shadcn.com)
