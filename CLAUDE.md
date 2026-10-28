# CLAUDE.md

This file provides guidance to Claude Code when working on this project.

## What this is

`materm-admin-frontend` (Materm Admin) — a Next.js 16 App Router admin/back-office panel:
auth (sign-in, forgot/reset password, accept invitation, profile), the IAM/ops screens (users, roles +
permission matrix, audit log, locales, system status + cache purge), the media library + MediaPicker, the generic
revisions tab, the save-live screens (menus, site settings, SEO, UI strings, categories / tags), a protected layout shell and
shared infrastructure. It has no backend of its own; the other CMS content screens come in later milestones.

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript |
| Server state | TanStack React Query |
| Client-only state | Redux Toolkit (one small `ui` slice) |
| HTTP | axios (`src/lib/axios.ts` — one authenticated + one public instance) |
| Forms | react-hook-form + zod (fixed forms); the schema-driven section forms use their own engine (below) |
| Schema forms | Ajv 2020-12 (client validation), Tiptap 3 (rich text JSON), dnd-kit (sortable lists) |
| UI kit | shadcn/ui ("new-york" style) + Tailwind v4 |
| i18n | next-intl, cookie-based locale (`la` default, `en`) — no `[locale]` route segment |
| Auth | JWT in cookies (`js-cookie`), client-side `(protected)` route-group guard; no edge auth gate (`src/proxy.ts` only sets the CSP) |
| Tests | Vitest + Testing Library + MSW (`npm run test`); `diff` (word-level text diff of revisions) |

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
npm run build
npm run lint
npm run typecheck   # tsc --noEmit
npm run test        # Vitest (unit + component, MSW for HTTP); `npm run test:watch` while developing
```

Tests live next to the code (`*.test.ts(x)`); helpers in `src/test/` (`renderWithIntl` renders with the real
`i18n/en.json`, `apiError()` builds an AxiosError, `server` is the MSW server — an unmocked request fails the
test). Verify UI work in a CLONED copy of the repo (`next build` + a click-through, e.g. with `playwright-core` +
system Chrome installed OUTSIDE the project; the sign-in `Globe` needs `--use-angle=swiftshader`), not in the
working folder.

Env vars: `NEXT_PUBLIC_API_BASE_URL` in `.env.development` / `.env.production` (no secrets in this layer);
`NEXT_PUBLIC_MEDIA_ORIGINS` (optional, comma separated origins, set in the deployment env) lets `img-src` of the CSP
load media pictures from another origin (`media.staticBaseUrl` / the file service);
`NEXT_PUBLIC_API_MOCKING=true` is for a SCRATCH CLONE only, on the command line (never an `.env` file): see "Mock API" below;
`.env.development` also sets `NEXT_PUBLIC_DISABLE_AUTH_GUARD=true` (bypass user, dev only, never in `.env.production`).
The backend allows only the origins in its `server.corsOrigins` (dev default `http://localhost:3000`): on another
dev port add that origin there and set the backend's `server.adminBaseUrl`.

## Current scope

Screens and building blocks built so far (phase P1 milestone M1; contract `../doc/05-api-spec.md`, screen specs
`../doc/07-admin-ui.md` section 3). No CMS content screens yet (pages, posts, media... are M2+).

- **W0 foundation (T1.1.9)** — `src/components/ui/` (shadcn primitives), `src/components/global/` (`ListPage` +
  `useListParams`, data table, pagination, filters, `PermissionGate`, `ConfirmDialog`, `OneTimeSecretDialog`,
  `ConflictDialog`, `DateTimeField`, `states/*`), `src/components/layout/` (header, `RoutePermissionGuard`,
  breadcrumb context, `NoPermission`), `src/components/provider/` (query, redux, theme, `NavigationGuardProvider`),
  `src/lib/axios.ts` (authenticated + public instance, token refresh), `src/lib/etag.ts`, `src/lib/idempotency.ts`,
  `src/lib/form-errors.ts`, `src/lib/security/csp.ts` + `src/proxy.ts`, `src/redux/` (one small `ui` slice),
  `src/i18n/request.ts`, `i18n/{en,la}.json`, test helpers `src/test/` (`renderApp` in `render-app.tsx`).
- **Auth — public pages (outside `(protected)`, no session needed)**: SCR-01 sign-in (`src/app/auth/sign-in/`,
  `components/auth/signin-form.tsx`, link to forgot-password, one-shot notices `session_ended` / `password_reset`);
  SCR-02 `/auth/forgot-password` (always the same neutral success text, never the server's `message`; 429 =
  inline wait from `Retry-After`); SCR-03 `/auth/reset-password`; SCR-04 `/auth/accept-invite`. SCR-03/04 read the
  one-time token from the URL **fragment** (`#token=…`) with `hooks/use-fragment-token.ts` +
  `lib/url-token.ts`: read once in an effect (survives React Strict Mode), removed from the address bar at once
  with `history.replaceState`, kept only in component state and sent only in the POST body (never logged, never
  in a query key or URL). The calls use the PUBLIC axios instance (`AuthAPI.ForgotPassword/ResetPassword/
  VerifyInvitation/AcceptInvitation`). Reset success -> `clearSession()` + sign-in notice; accept -> TokenPair
  stored like a sign-in, cached queries dropped, old session (if the browser had one) ended best-effort, then
  `/admin`. Password feedback: `components/auth/password-policy-checklist.tsx` + `lib/password-policy.ts`
  (length in code points; the SERVER decides: common / reused rows turn red from its `password_policy.*` codes).
  Other: forced/regular change-password dialog `components/auth/change-password-dialog.tsx`, `hooks/use-auth.ts`
  (current user, `useHasAction`, login/logout, change password, forgot/reset/verify/accept mutations),
  `services/auth.api.ts`, `lib/auth-session.ts` (cookies + notices), `lib/api-error*.ts` + `hooks/use-api-error.ts`.
- **Protected shell** — `src/app/(protected)/(routes)/layout.tsx` (sidebar + header + guard),
  `components/navbar/` (`nav-main.tsx`: a detail page such as `/admin/users/5` marks its entry and opens its group,
  `/admin` matches exactly; `nav-user.tsx` has Profile / Change password / language / theme / sign out),
  `lib/nav-main-items.ts` (sidebar config AND route-permission map), `lib/constants/breadcrumb.ts`, the empty
  `/admin` dashboard.
- **W1 (T1.1.10)** — `/admin/users` list (role/state filters, sort in the URL) + `/admin/users/[id]` detail
  (profile edit with ETag/`If-Match`, Security tab, History tab, commands: activate / deactivate / unlock / delete /
  reset password / force password change / revoke sessions / resend invitation); `/admin/roles` list + create/edit
  dialogs + `/admin/roles/[id]` permission matrix (tick rules, +n/-m review dialog, `PUT` with `If-Match`, 412/409
  `ConflictDialog`, system roles read-only, `ROLE_IN_USE`); `/admin/audit` (filters, detail drawer, JSON diff);
  `/admin/locales` (list + edit sheet); `/admin/system` (status). Code in `components/protected/{users,roles,
  audit,locales,system}/`, `hooks/use-*.ts`, `services/*.api.ts`, types in `types/`.
- **W1b (T1.1.11)** — SCR-02/03/04 (above); SCR-06 `/admin/profile` (`components/protected/profile/`: name,
  preferred language `en`|`la` with ETag/`If-Match` + `ConflictDialog`, read-only account facts, change-password
  dialog; saving a different language sets the `locale` cookie and calls `router.refresh()`; the route is
  `ROUTE_ONLY_PERMISSIONS` open); SCR-07 "Invite user" (`CreateUserDialog` has two modes: `invite` = e-mail
  required, no username/password, result dialog `invitation-sent-dialog.tsx` shows `email_delivery`
  queued / logged_only; `temporary_password` = the old flow with the one-time password dialog; each mode has its
  own `Idempotency-Key` per dialog open).

- **W2a schema-driven form engine (T1.2.10)** — `components/schema-form/` renders a section's props form from
  `GET /section-types/{key}` (`json_schema` + `ui_schema`); built against MSW, no backend yet. See "Schema form
  engine" below. Pieces: `SchemaForm` (+ `SchemaFormHandle`), `compile-field-tree.ts`, `validate.ts`,
  `completeness.ts`, `issues.ts`, `widgets/*`, `data/*` (picker lookups), `use-schema-validation.ts`,
  `use-schema-form-state.ts`; `components/rich-text/` (`RichTextEditor` lite/full), `components/global/sortable-list.tsx`
  (`SortableList`), `components/global/locale/editor-locale-switcher.tsx`, `hooks/use-section-types.ts`
  (`useSectionType(key, version?)`, `useSectionTypes`), `hooks/use-autosave.ts`, `services/section-types.api.ts`,
  `types/cms.d.ts`. Dev playground: `/admin/dev-tools/schema-form` (not-found page in production, HTTP status 200; not in the sidebar, route-only
  entry in `lib/nav-main-items.ts`; a folder called `_dev` would NOT be routed by Next.js). Shadcn primitives added:
  `alert`, `progress`, `radio-group`, `toggle-group`.

- **T1.3.9 media library, MediaPicker, revisions, cache purge (M3)** - built against MSW + the typed API layer; the
  backends are written in parallel (contract = `doc/api/openapi-admin.yaml`, `doc/05` sections 11.6 - 11.8). See
  "Media, revisions and cache purge" below. No upload anywhere (P2, AS-2).

- **T1.3.8 save-live screens (M3)** - built against the mock API (the backend routes are written in parallel). See
  "Save-live screens" below.

- **T1.4.7 PublishBar, pages list, publishable history (M4)** - built against the mock API (no page routes in the backend
  yet). See "Pages and publishing" below. Preview links: see "Preview links (T1.4.4 UI)".

- **T1.4.8 page editor + section editor (SCR-20 / SCR-21, M4)** - built against the mock API (no section routes in the backend yet).
  See "Page editor (T1.4.8)" below.

To add a module, follow the feature-vertical pattern:
`src/app/(protected)/(routes)/admin/<feature>/page.tsx` + `src/services/<feature>.api.ts` +
`src/hooks/use-<feature>.ts` + `src/types/<feature>.d.ts` + `src/components/protected/<feature>/`,
add its endpoints to `src/lib/constants/api-endpoints.ts`, a nav entry in
`src/lib/nav-main-items.ts`, a breadcrumb entry in `src/lib/constants/breadcrumb.ts`, and its
i18n namespace in both `i18n/en.json` and `i18n/la.json` (`src/i18n/messages.test.ts` fails when the two files
differ). A public page goes under `src/app/auth/`.

## Auth / permission rules (P0d, matches doc/05)

- `lib/axios.ts`: ONE shared `GET /jwt/refresh` for concurrent 401s (`UNAUTHENTICATED`,
  `TOKEN_EXPIRED`, `AUTHZ_CHANGED`), rotated pair stored, each request retried once. 401
  `SESSION_REVOKED` / `REFRESH_REUSED` / `REFRESH_REPLAY_UNAVAILABLE` or a 401 from the refresh
  call -> clear session + hard redirect to sign-in. **403 and 429 never sign out or redirect**;
  `QueryProvider` toasts them (and network/5xx) once, forms handle 400/404/409/422 themselves
  (`useApiErrorHandler`).
  **A read that ends in 403 (or an auth error that did not end the session) is shown as the "no permission" state
  (`components/layout/no-permission.tsx`, `isNoPermissionError`): never retried (React Query does not retry any 4xx;
  one retry for network/5xx) and not toasted. Every page that fetches data must render `NoPermission` for it.** Decide on the error `code`, never on `message`.
- Error text: `errors.codes.<CODE>` / `errors.fields.<field code>` in `i18n/*.json` (field codes with a
  dot are nested JSON). Field errors (`errors[]`, JSON-Pointer `path`) are mapped onto form fields.
- Public self-service pages (`/auth/forgot-password`, `/auth/reset-password`, `/auth/accept-invite`) use `axiosPublicInstance` only and
  need no session; links in e-mails carry the token in the URL fragment (see above).
- `must_change_password` (from `/auth/me`) or a 403 `PASSWORD_CHANGE_REQUIRED` -> the guard renders only
  the forced change-password dialog until it is cleared.
- `actions: []` / missing key = NO access (`userHasAction`, `useHasAction`). Routes/nav need `read`
  (`getReadablePermissionKeys`). `NEXT_PUBLIC_DISABLE_AUTH_GUARD=true` (dev) gives a bypass user with all
  22 keys / 15 actions (`lib/constants/permissions.ts`, mirror of the backend catalog seed).
- **Route guard is default-deny** (`lib/nav-main-items.ts`): `getPermissionsForPath(pathname)` returns
  `{kind: "open" | "requires" | "unknown"}`. A page must be covered by a sidebar entry (longest-prefix; its
  sub-pages inherit it) or by an entry of `ROUTE_ONLY_PERMISSIONS` (`open: true` or `anyPermission`); `/admin`
  itself matches exactly, so an unregistered `/admin/foo` is `unknown` -> "Page not found" (+ `console.warn` in
  dev), it does NOT inherit the dashboard's open access. **Adding a page = registering its route.** The guard
  only checks `read`; action-level rules (create/update…) go in the page with `<PermissionGate>`.
- **Optimistic locking (`lib/etag.ts`)**: a service for a resource with a lock reads `withEtag(response)` ->
  `{data, etag}` (keep it in the query data), writes send `If-Match` with `ifMatch(etag)` /
  `ifMatchHeaders(etag, {required: true})` (mandatory for `PUT /roles/{id}/permissions`, `PATCH /roles/{id}`
  and cms/forms roots; it throws `MissingEtagError` instead of sending a request that would get 428). A
  response with a new ETag goes into the cache with `setQueryData`. 409 `CONFLICT_LOCK_VERSION` / 412 =
  `isConflictError(error)` -> open `ConflictDialog` (no force-overwrite); `handleFormError(..., {onConflict})`
  hands it over. 428 is a client bug: toast + `console.error` (QueryProvider).
- Other W0 building blocks (doc/07 section 5.2): `ListPage` + `useListParams` (URL = list state, invalid values
  dropped), `PermissionGate` / `useCan` / `useCanEditOwn`, `ConfirmDialog` (`requireTyping`),
  `OneTimeSecretDialog` (secret shown once, not dismissable, never stored), `NavigationGuardProvider` +
  `useUnsavedChangesGuard(isDirty, {onSave})` + `useGuardedNavigate` (tab close, in-app links, Back button =
  best effort), `BreadcrumbProvider` + `useBreadcrumbTitle(name)`, states in `components/global/states/`
  (`ForbiddenState` = `NoPermission`, `NotFoundState`, `ErrorState`, `EmptyFiltered`, `FetchingBar`,
  `EditorSkeleton`), `DateTimeField` + `lib/datetime.ts` (Asia/Vientiane <-> UTC), `lib/idempotency.ts`
  (`Idempotency-Key` once per dialog open: `useIdempotencyKey`), `pointerToFieldPath` /
  `applyFieldErrors(..., {nested: true, onLocatedError})` for nested JSON-Pointer errors, `Accept-Language`
  (UI locale cookie) on every request.
- **CSP / security headers**: `src/proxy.ts` sets a per-request `Content-Security-Policy` with a nonce
  (`src/lib/security/csp.ts` holds the policy: strict `script-src`, `connect-src` = the app + the API origin
  from `NEXT_PUBLIC_API_BASE_URL`); static headers are in `next.config.ts`. A new external origin (file/media
  host, iframe preview) must be added to the policy. The root layout passes the nonce to `next-themes`.

## Media, revisions and cache purge (T1.3.9)

- **`/admin/media`** (SCR-35, sidebar entry `nav.media`, key `media.library`; breadcrumb `breadcrumb.media`):
  `components/protected/media/media-library.tsx`. List state in the URL through `useListParams(MEDIA_LIST_CONFIG)`
  (`kind`, `folder_id` = id or `root`, `unused`, `missing_alt`, `trashed`, sort, keyword); the open file is
  `?asset=<id>` and is NOT part of the list config (opening / closing keeps the list params; a list change drops it);
  grid / list choice is a per-browser preference (`use-media-view.ts`, `localStorage` in try/catch). Folder tree =
  `media-folders.tsx` (create / rename-move / delete, `Idempotency-Key` once per dialog open). Selection works, but there
  is no bulk endpoint in P1 (`POST /media/assets/bulk` is P2, and the list rule forbids looping single requests): the bar
  only offers "Copy file names". `url: null` (no `media.staticBaseUrl`) and a picture the browser can not load (CSP,
  404) both show a placeholder tile (`media-thumb.tsx`).
- **Detail sheet** (SCR-36, `media-asset-sheet.tsx`): the editor is keyed by the asset's ETag (`withEtag`), so a save or a
  reload from the `ConflictDialog` starts a fresh draft; the chosen language / tab live in the parent. Escape / the X / the
  overlay go through the editor's `requestClose` (ref registered in the parent) so unsaved edits are asked about first (a plain
  `router.push` is not stopped by the navigation guard). Draft -> PATCH body
  in `asset-draft.ts` (only changed fields, caption / credit cleared = `null`, focal rounded to 3 decimals). Permissions:
  `update` (or `update_own` on my upload - seed rows have `created_by = null`, so never) edits everything, `translate`
  only alt / caption / credit, `delete` deletes / restores. A used file (`usage_count > 0`) has Delete disabled with a link
  to the usage tab; `MEDIA_IN_USE` / `ENTITY_REFERENCED` from the server (stale page) open `InUseDialog` with the list
  (`UsageList` links only owners whose route exists, `usageHref` in `lib/media.ts`). Languages = active locales; without
  `cms.locales:read` it falls back to the languages the file already has.
- **`MediaPicker`** (`media-picker.tsx`): props `{ open, onOpenChange, mode: "single" | "multiple", max, accept (mime),
  ratio, selectedIds, onSelect(assets), title, description, searchLabel, defaultLocale }`. Single = a click picks and
  closes; multiple = toggle + "Add selected"; arrows / Home / End move between tiles. It reads through `SchemaFormData`
  (`listMedia`, `listMediaFolders`; `apiSchemaFormData` = the API, `memorySchemaFormData` = fixtures), and
  `MediaPickerDialog` of the schema form's `MediaField` is now a thin wrapper of it (same accessible names as before).
  Pass `defaultLocale` when the host knows it (saves a `/locales` request). In multiple mode the images already chosen are
  resolved by id (`MediaQuery.ids`, <= 50, sent alone as the API requires) so "Add selected" returns them even when they
  are on another page / folder; it stays disabled until they are loaded. `SchemaFormData` now REQUIRES `listMedia` and
  `listMediaFolders` (any new implementation must provide them).
- **`RevisionsTab`** (`components/global/revisions/`, SCR-37): `<RevisionsTab resource id canRestore onRestored etag?
  resolveEtag? onRefresh? currentSnapshot? restoreEffect? pageSize? />`. `resource` is one of `menus`, `settings`,
  `ui-strings`, `categories`, `tags`, `media/assets` and the publishable `pages` (`lib/revision-resources.ts` maps it to the URL base
  and the keys; `publishable: true` switches the publishable wording, see "Pages and publishing"); `id` is the entity's id or key (menu key, settings group, ui-string key). Save-live
  revisions are the state BEFORE an edit: who / when = the edit that replaced it. Restore sends `If-Match` = the `etag` prop
  (the entity's ETag as the editor holds it), else `resolveEtag()`, else the entity's own GET; `onRestored({ data, etag,
  restoredFrom })` is where the editor re-seeds its cache with the new ETag; 409/412 -> `ConflictDialog` (`onRefresh`);
  `snapshot_incompatible`, `trashed`, 422 `unknown_reference` (`in: "entity"`, paths shown as field names) and
  409 duplicates are explained inside the dialog. `include_preview` is sent only when the switch is on and `is_preview`
  rows are also filtered client-side. `DiffView` / `SnapshotView` (`diff-view.tsx`, `snapshot-diff.ts`) turn any snapshot
  into labelled fields (arrays of rows with `locale_code` / `public_id` / `key` / `id` are keyed by it), grouped by language,
  word-level text diffs with `diff`. Labels: `revisions.fields.<name>` in the i18n files (add new field names there).
  `assetSnapshot()` (`protected/media/asset-snapshot.ts`) is the pattern for `currentSnapshot`.
- **Cache purge** (SCR-45): `protected/system/cache-purge.tsx` inside `SystemStatusView`, shown only with
  `ops.system:execute`. Tags are validated with the exact allow-list (`lib/cache-tags.ts`), `scope=all` needs a second
  confirmation, 429 (with `Retry-After`) / 403 / 503 / 422 `/tags/<i>` are explained in the dialog (the global toast also
  fires for 403/429/5xx), the answer lists the tags the server really queued. No `Idempotency-Key` (05 11.1.5).
- **CSP**: pictures of another origin need `NEXT_PUBLIC_MEDIA_ORIGINS` (`lib/security/csp.ts` `mediaOriginsFromEnv`); only
  `img-src` is widened, only for http(s) origins.

## Save-live screens (T1.3.8)

Save-live = a write changes the website at once (no draft, no publish). Contract: `doc/05` sections 11.1 - 11.5 and 11.7,
`doc/api/openapi-admin.yaml`. Every write sends `If-Match`; the answer's new ETag goes into the cache (no refetch);
409 `CONFLICT_LOCK_VERSION` -> `ConflictDialog`; every screen has a history (`RevisionsTab`); a user with `translate` but not
`update` only edits texts (the rest is disabled and not sent), a user with `read` only sees no mutation control.

| Route | Screen | Key | Code |
|---|---|---|---|
| `/admin/menus`, `/admin/menus/[key]` | SCR-17 / SCR-18 menu cards + tree editor | `cms.menus` | `protected/menus/` (`menu-editor`, `menu-item-form`, `menu-draft`) |
| `/admin/settings` -> `/admin/settings/[group]` | SCR-15 groups `brand`, `contact`, `footer`, `site` | `cms.settings` | `protected/settings/` (`settings-editor` is generic over the group's `fields[]`) |
| `/admin/seo` | SCR-16 group `seo` + SERP preview + robots / sitemap facts | `cms.seo` | `protected/seo/` (reuses `SettingsEditor` with an `extras` slot) |
| `/admin/blog/categories`, `/admin/blog/tags` | SCR-26 two screens (plain links as tabs) | `cms.categories` | `protected/taxonomy/` |
| `/admin/ui-strings` | SCR-34 table, edit sheet per key x language, bundle sync | `cms.ui_strings` | `protected/ui-strings/` |

Sidebar: groups `nav.content` (menus, categories, tags) and `nav.site` (settings, seo), direct entry `nav.uiStrings`;
`/admin/blog` itself is NOT registered (posts come later). Types `types/{menus,settings,ui-strings,taxonomy}.d.ts` follow the
OpenAPI schemas one by one; services / hooks `services|hooks/{menus,settings,ui-strings,taxonomy}`; paths in `API_ENDPOINTS`.

- **Menus**: flat in P1 (`parent_id` null, `maxDepth` 1). Order is edited locally (`SortableList`: drag, keyboard, up / down) and sent ONCE
  with "Save order" (`PUT .../items/order`, the id set must equal the menu's). Create does not send `position` (appends). `social` menu:
  icon from `options.icons` (required), `https://` only. Page picker = `GET /pages?limit=100` (`id`, `title` / `name`, `path`, `status`).
  A restore answers `MenuDetail`; the editor seeds the cache with it.
- **Settings**: the form is built from `fields[]` (value type, localized, required, limits); a `PUT` replaces the group (empty -> `null`, a
  language with no text is left out = its row is deleted). ETag = the group's revision number (`"0"` before the first edit). Media keys use
  `MediaPicker`. `settings-draft.ts` has the client checks (same rules and `/values/<key>[/<locale>]` pointers as the server).
- **UI strings**: "changed" (`is_override`) = value differs from the bundle text (`source`); `lib/icu.ts` (`@formatjs/icu-messageformat-parser`,
  pinned 3.5.21) checks syntax, plural `other` and the placeholder set before a save (server codes `icu_syntax`, `plural_other_missing`,
  `placeholder_mismatch`). "Still English in <language>" sends `locale=<l>&same_as=en` and narrows the table to that language.
  **Key-level restore ETag (PROVISIONAL contract)**: the quoted number of the key's latest revision, read from the `ETag` header of
  `GET /ui-strings/{key}/revisions` (fallback: built from the first row); it lives ONLY in `lib/ui-string-etag.ts`
  (`formatUiStringKeyEtag` = the one line to change, e.g. to a weak validator). Bundle sync: choose `ui-strings.json` -> dry run -> apply.
- **Categories / tags**: `key` immutable (shown read-only), soft delete (30 days) with the trash switch (needs `delete`), `ENTITY_REFERENCED`
  -> dialog with "Deactivate instead" (categories), restore clash -> 409 `CONFLICT_DUPLICATE` explained. Order = up / down buttons, each a
  swap of two `PATCH {sort_order}` (no order endpoint, C-30); a list row has no ETag, `etagOfRow` builds it.

### Mock API (`src/mocks/`)

T1.3.8 split the model: `mock-core.ts` (error envelope, clock, helpers, `MockDb` type), `mock-menus.ts`, `mock-settings.ts`,
`mock-ui-strings.ts`, `mock-taxonomy.ts`, bound in `handlers.ts` (`saveLiveApiHandlers`); `mock-db.ts` keeps media / revisions / purge and
routes a restore to the entity's module. Seeds come from the admin backend seeds (menus, the 19 P1 settings keys (the 2 `analytics` keys are P2 = 404), `ui-strings.json` copied to
`mocks/seed/`, 5 categories); INVENTED: the people and older versions in the histories, the draft / trashed pages, the posts that make the
"in use" rules visible, 3 tags (one trashed), 3 changed UI strings and one orphan row. `db.translateOnly = ["menus" | "settings" | "seo" |
"categories" | "ui-strings"]` makes the model act as a translate-only writer (403 rules of 05 11.1.3).


`mock-db.ts` is a strict in-memory model of the media / revisions / purge endpoints (unknown query params and body fields
are 422, no `If-Match` is 428, a stale one 409, `MEDIA_IN_USE`, `snapshot_incompatible` ...), seeded with the 24 `static/`
assets of the portal bundle; `handlers.ts` binds it to MSW (`*/api/v1/...`, base-agnostic). Tests: `useMockApi()` from
`mocks/test-setup.ts` in a `describe` (fresh model per test; extra `server.use(...)` handlers go in front). Browser: the
dev playground `/admin/dev-tools/media` (picker, revisions on media / menu / settings, purge) installs it itself
(`api-mocking-impl.tsx`, an axios adapter on top of msw's `getResponse`: no service worker, no `public/` file);
`NEXT_PUBLIC_API_MOCKING=true` on the command line of a scratch clone (`NEXT_PUBLIC_API_MOCKING=true
NEXT_PUBLIC_DISABLE_AUTH_GUARD=true npx next build` / `next dev`) mocks the whole app so `/admin/media` and
`/admin/system` can be clicked through. `next.config.ts` pins the flag to a build-time literal, so a normal build contains
none of it (checked: no mock strings in `.next`). The model is a stand-in, not the backend: when the real endpoints exist,
delete nothing here - just stop using the flag.

## Pages and publishing (T1.4.7)

Contract: `doc/05` sections 12.2 - 12.8, `doc/api/openapi-admin.yaml` (PageListItem ... PublishBlockedError). Two decisions made after
05 12.7 was written: **UNPUBLISH always succeeds** (a pending draft becomes a `history` row and the answer carries the warning
`draft_kept_as_history`; no 409 `draft_has_broken_references`), **DISCARD-DRAFT turns the draft into a `history` row** (change note
"discarded"), it is not deleted. The client reads a success' warnings from `data.warnings[]` (OpenAPI) AND `details.warnings[]` of the
envelope (the task's wording), so either works.

- **`PublishBar`** (`components/global/publishing/publish-bar.tsx`, SCR-38), generic by `resource` (`lib/publishable-resources.ts`:
  URL base, `cms.pages` permission key, preview actions; posts / albums / FAQ / forms add one entry in M5). Props: `resource`,
  `entity` (`{id, status, has_unpublished_changes, deleted_at?, is_home?, is_system?}`), `etag` (the host's current one: every command
  sends it as `If-Match`; no ETag = commands disabled), `isDirty` (Publish disabled with a reason until saved), `flush()` (awaited
  before the dry run; `false` stops), `onSaveDraft` / `isSaving` (the host's own save; no callback = no button), `onResult({action,
  data, etag, warnings})` (EVERY answer, with the NEW ETag: the host `setQueryData`s it, no refetch - `writeThroughPage` in
  `hooks/use-pages.ts` does it for pages), `onRefresh` (ConflictDialog "load the latest"), `onGoToField(PublishIssueTarget)`,
  `onCreatePreviewLink` (opens the host's `PreviewLinkDialog`, see "Preview links (T1.4.4 UI)"; without it the button is shown disabled with a tooltip; a resource whose entry has `previewLinks: false` hides the button). Controls the user may not use are hidden
  (`publish` / `unpublish` / `update` for discard and save / `read` + `update|review` for preview).
  **Publish = dry run first** (`?dry_run=true`, no ETag change): 422 `PUBLISH_BLOCKED` -> `PublishBlockersDialog` (blockers grouped
  by page / structure / section, "Go to field" per blocker when `onGoToField` is given, warnings listed), pass -> `PublishConfirmDialog`
  (incomplete languages from `translation_incomplete`, other warnings, change note) -> the real publish. The dry run counts toward the
  server's 60/h publish limit (05 12.7.6): that is the price of showing the summary before the confirmation. A 422 on the real publish
  opens the blockers as well. **Idempotency-Key**: one per dialog open (`useIdempotencyKey`), only on the real publish and unpublish
  (never on the dry run), reused by a retry of the same dialog; the `confirm_references=true` repeat is another request and has its own
  key. **Unpublish**: ConfirmDialog, 409 `ENTITY_REFERENCED` -> `ReferencedDialog` (also used by the pages list delete) -> repeat with
  `confirm_references=true` (the first request never carries it); a success with `draft_kept_as_history` / `page_referenced` shows a
  dismissible notice. 409 `CONFLICT_LOCK_VERSION` -> `ConflictDialog`; 409 `INVALID_STATE` -> the `publishing.invalidState.<reason>` text
  and `onRefresh`. `StatusBadge` / `TranslationBadges` are in `components/global/status/`.
- **`/admin/pages`** (SCR-19, `nav.pages` = first entry of the Content group, key `cms.pages`): `protected/pages/pages-list.tsx`
  (`ListPage`; URL: status (multi) / template (multi) / `is_home` / `has_unpublished_changes` / `trashed`), `page-create-dialog.tsx`
  (template from `GET /page-templates` with its description and initial sections, title in the default language, address filled from the
  title until edited, client path rules in `page-draft.ts`, Idempotency-Key per open, then opens the new page), `page-set-home-dialog.tsx`
  (offers the old home's new address). Row menu: open, make home page (published, not home), move to the trash (not home, not system).
  **Delete does not call `/references` first**: the first `DELETE` has no `confirm_references`, the 409 carries the list (PG-13), the
  repeat confirms. The ETag of a row is `"<lock_version>"` (`pageEtag`), a stale row = toast + reload. `services/pages.api.ts`,
  `services/publishing.api.ts`, `hooks/use-pages.ts`, `hooks/use-publishing.ts`, types `types/{pages,publishing}.d.ts`.
- **`/admin/pages/[id]`** (`protected/pages/page-host.tsx`) loads the page (404 / 403 / error states), shows title + address + the trash
  notice and renders `PageEditor` (below), keyed by a `generation` counter (a re-seed remounts it).
- **`RevisionsTab` for a publishable resource** (`isPublishableResource`): rows `draft` / `published` / `history` / `restore`, the live
  version marked (`is_live`), columns "Date" / "By" (not "replaced on"), the draft row has no Restore, restore is "Restore as draft"
  (never reaches the website; the current draft is kept as a `restore` row), preview rows hidden unless the switch is on, a view of a
  `published` / `draft` row says who published / started it. Wording lives in `revisions.publishable.*` and `revisions.restore.*Draft`.

Mock additions (`src/mocks/mock-pages.ts`, bound in `handlers.ts`): a strict model of `GET/POST /pages`, `GET /page-templates`,
`GET/PATCH /pages/{id}`, `DELETE`, `restore`, `set-home`, `references`, `GET sections` / `GET|PATCH sections/{id}`, `publish`
(dry run), `unpublish`, `discard-draft`, `GET revisions` / `{revId}` / `restore`. `db.pages` is now the full page model (the menu mock
reads its live rows). Seeded: pages 1 - 5 from the examples of `doc/content-schemas` (system pages), INVENTED 6 - 10 (6 = every kind of
blocker, 7 = trashed, 8 = a draft that publishes with warnings, 9 = published with a pending draft + a preview row + history, linked
from 10), albums, `Idempotency-Key` replay. Blockers are computed from the page state with the schema form's `computeCompleteness`.
With `NEXT_PUBLIC_API_MOCKING=true` the browser exposes `window.__MATERM_MOCK__.touchPage(id)` (someone else saved the page: the next
command with the old ETag is a 409, the model is per tab so a second tab cannot do it).

## Page editor (T1.4.8)

`/admin/pages/[id]` = SCR-20 (page editor) + SCR-21 (section editor). Code in `components/protected/pages/editor/`; the host
`page-host.tsx` only loads the page and renders `<PageEditor page etag onReseed />` with `key={generation}`.

- **Layout**: `PublishBar` (wired for real: `isDirty` = page fields OR open section dirty, `flush` / `onSaveDraft` = save both and
  return `false` on any failure, `onResult` writes the answer through, `onGoToField`) -> `PageCompleteness` (per active language: a
  progress bar from page title / SEO title / SEO description + every visible section's `translation_status`) -> tabs **Content**
  (default), **Details**, **SEO**, **History** (`?tab=`; Content is `forceMount`ed + hidden so the open section keeps its unsaved edits).
  Content = `SectionList` (22.5rem) next to `SectionEditor` at `lg`; below `lg` it is list OR editor with a "All sections" back button.
  URL: `?section=<id>`, `?locale=<code>` (the SECTION form's language) and `?seoLocale=<code>` (the SEO tab's own language, absent = the default language; B6 of the cross-system e2e: English picked in the section editor used to switch the SEO tab too and hid the required default-language SEO title). "Go to field" sets `?locale=` for a section pointer and `?seoLocale=` (from `/translations/<l>/...`) for a page pointer. While the SEO tab shows another language and the default one has no SEO title, a notice (`data-testid=seo-default-missing`) with a "Show <default>" button brings it back in one click.
- **State lives in the editor, not in a tab**: the Details + SEO draft is ONE `PageFieldsDraft` (`page-fields.ts`: `draftFromPage`,
  `validateFields`, `buildPatch` = only what changed; a language whose texts are all cleared is sent as `null`, never the default one;
  server 422/409 field errors are mapped back to `title.<l>` / `path` ... keys). `edit === null` means "untouched": the baseline is
  derived from the page in the cache, so a saved page re-bases itself. The open section's draft lives in `SectionEditor`
  (`useSchemaFormState`, guard off + own `useUnsavedChangesGuard`) and is reached through `SectionEditorHandle {save, discard, isDirty}`.
  Switching section with unsaved edits asks (save and open / discard / keep editing).
- **ETag / cache rules** (`hooks/use-page-sections.ts`): sections query key = `["/pages/<id>/sections"]` (NOT under `["/pages"]`, which
  `writeThroughPage` invalidates); it loads `?include=props`. A section write answers `{section, sections[order], aggregate}` and the new
  ETag header, NOT the page: `applySectionWrite` sets the page's ETag, copies `lock_version` / `status` / `has_unpublished_changes` /
  `updated_at` / `section_count` from `aggregate`, patches the sections cache; no refetch. `usePageWrites(pageId)` runs every write ONE AT A
  TIME (promise chain) and reads the ETag from the cache when its turn comes. `updatePage` (details / SEO) uses `writeThroughPage`.
  After discard / History restore / "load the latest" (`onReseed`): refetch page (not for discard / restore: already written through) +
  sections, THEN bump `generation` so every form starts again from the server's version.
- **Section list** (`section-list.tsx`): drag / keyboard / up-down (`SortableList`); **a move is sent at once** as `PUT .../order` (07 SCR-20,
  no "Save order"); the new order is shown while it flies, a 422 puts the old one back with a toast; the client refuses first what the
  template forbids (`section-structure.ts` `orderProblem`: hero first, after_hero). Eye = `PATCH {is_visible}`. `...` menu: insert
  above / below (instead of `[+]` between rows), delete (hidden for `required` sections and without `cms.sections:delete`; ConfirmDialog says
  it can be recovered from History). Chips: Hidden, Not supported, Required, languages that miss texts (`en ⚠3`), "n problems" (422 of the
  last save), amber dot = unsaved edits. A panel lists the template's requirements (hero, contact section ...) as met / missing.
  Duplicate / copy-to / detach / shared sections are P2 (not built). No example pictures in the picker (Q-07-6).
- **Picker** (`section-type-picker.tsx`): `usePageTemplates()` allowed sections x `GET /section-types?is_active=true&scope=page`;
  `max_per_page` reached = disabled with the reason; `resolvePosition` puts a hero on top and an after-hero section below the hero (said
  under the cards); `Idempotency-Key` once per open.
- **Section editor** (`section-editor.tsx`): `SchemaForm` mode `draft`, `serverErrorPrefix="/props"`, controlled `?locale=`. Draft = props +
  variant (RadioGroup from `ui:variant`); "Save section" = ONE `PATCH` with `props` only when props changed and `variant` only when it
  changed; hidden switch = immediate `PATCH {is_visible}`. 422 -> the array is kept as `serverErrors` (form focuses the first), `/variant`
  error shown at the radios, count in the list; 409 -> editor's `ConflictDialog`; 403 is toasted globally. **Rights**: `cms.sections:update`
  = full; only `translate` = `translateOnly` (all but `x-localized` disabled, `variant` never sent, no hidden switch, list read-only);
  read only / trashed page = no mutation control; unsupported type (`unsupported` or 404 type) = props JSON read only. Autosave: ONE
  per-browser switch (`useAutosavePreference`, OFF by default, Q-07-7) in the tab bar; the section editor and the page fields each run
  `useAutosave` (30 s debounce) through the same save functions.
- **Details tab**: title per active language (+ "show this language" switch), internal name (read only for system pages), address (client
  rules of `page-draft.ts`; read only for the home page and `blog`; the `path_changed_published` warning appears while the address of a
  page that was ever published is edited), template (select only while the page has no sections, else read only), sort order.
  **SEO tab** (07 3.9, also holds `noindex` / `in_sitemap`: they are SEO fields, PG-14 lets `cms.seo:update` alone edit them): per language
  SEO title (60 recommended, 120 max), absolute switch, description (160 / 320), share image (`MediaPicker`), canonical address, SERP
  preview (title template + `site.base_url` from the `seo` / `site` settings when readable). Rights: texts = `pages|seo` update or
  translate; flags / image / canonical = `pages:update` or `seo:update`; structure = `pages:update`. A language without a title has its
  SEO fields disabled (the server would refuse a row without a title).
- **Go to field**: PublishBar's pointer goes into the URL in ONE `router.replace` (`?field=` + `sectionKey` + `sectionIndex` + `fieldCode`
  + tab / locale). An effect in `PageEditor` consumes it (so a link with `?field=` works too): `/sections/<public_id>/props/...` opens
  the section and hands `SectionEditor` a `focusRequest` (a new `serverErrors` batch with the blocker's code), which switches the language,
  opens the array item and focuses the field; page pointers (`/translations/<l>/seo_title`, `/path` ...) open Details / SEO and focus the
  input by id (`page-field-<name>[-<locale>]`); `/sections` focuses "Add section". Then the params are removed.
- **Mock additions** (`mocks/mock-pages.ts`, `mock-cms-lookups.ts`, bound in `handlers.ts`): `POST sections` (201 + `Location`,
  `Idempotency-Key`, `default_props`, position / `out_of_range`, the four template rules with 05 12.5.5 codes and paths, 60 limit,
  duplicate anchor 409), `PUT sections/order` (exact-set rules `duplicate` / `unknown_reference` / `required` + `params.missing`, template
  rules at `/sections/<i>/id`, unchanged = same ETag), `DELETE` (409 `INVALID_STATE` `section_required`), a strict `PATCH` (variant,
  `/props/...` draft checks WITHOUT Ajv: max length of localized text and strings, enum, array size, unknown media / page / album ->
  `unknown_reference`; nothing changed = same ETag; trashed page 409), translate-only 403 (`db.translateOnly` containing `sections` /
  `pages`: a differing value outside `x-localized`, or `variant` / `is_visible` / `anchor_id`, create / reorder / delete; page PATCH only
  title + SEO texts), `GET /section-types[/key]` and the picker lookups (`/posts`, `/albums`, `/albums/:id/items`, `/faq-groups`,
  `/forms`). Every write moves the PAGE's `lock_version`. In a mock-enabled build `window.__MATERM_MOCK__.setTranslateOnly(true|false)`
  turns the model AND the cached `/auth/me` into a translator (read + translate on pages / sections / seo) for a click-through.
- **Tests**: `editor/page-fields.test.ts`, `section-structure.test.ts`, `page-editor.test.tsx` (whole editor over the mock API),
  `mocks/mock-sections.test.ts`; `page-host.test.tsx` was updated (the "editor is coming" text and the `field-target` notice are gone on
  purpose: Go to field now opens the field).

## Preview links (T1.4.4 UI)

Contract: `doc/05` section 12.9, `doc/api/openapi-admin.yaml` (CreatePreviewLinkRequest, PreviewLinkCreated, PreviewLinkItem, PreviewLinkRevoked); the
backend is `materm-admin-backend/modules/cms/preview`. A link is **frozen at the SERVER's working copy of the moment it is issued** (a page that was never
published gets one too); it works for anyone who has it until it expires; the raw token exists ONLY inside the `url` of the one `201` answer.

- **Code**: `services/preview-links.api.ts` (`PreviewLinksAPI.Create/List/Revoke`), `hooks/use-preview-links.ts` (`usePreviewLinks`, `useMutationCreatePreviewLink`,
  `useMutationRevokePreviewLink`), `types/preview-links.d.ts` (the row field is `use_count`, not `uses`), `API_ENDPOINTS.PREVIEW_LINKS`,
  `components/global/publishing/preview-link-dialog.tsx` (`PreviewLinkDialog`) + `preview-link-errors.ts` (pure: `classifyPreviewCreateError`, `parseTtlMinutes`,
  `safeHttpUrl`). `PUBLISHABLE_RESOURCES[x].previewLinks` says whether the kind has links (pages yes; posts M5; albums / FAQ / forms never, PT-18); `PublishBar` hides
  the button without it and shows it needing `read` + `update | review`. **Wiring**: `PageEditor` passes `onCreatePreviewLink={() => setPreviewOpen(true)}` and renders
  `<PreviewLinkDialog resource entityId open onOpenChange isDirty flush isSaving />` with the same `isDirty` / `flush` it gives `PublishBar`.
- **Dialog**: language (active locales, default selected; without `cms.locales:read` the list is unavailable and no `locale` is sent), expiry (toggle 30 min / 1 h / 4 h /
  24 h / Custom 1..1440 whole minutes, checked before sending), "Create link" -> the address in a read-only field with Copy (clipboard API, `execCommand` fallback) and
  "Open in a new tab" (`rel="noopener noreferrer"`, only an http(s) address becomes an `href`), the "will not be shown again" note, then "Active links" of the page
  (`GET ?state=active&limit=50`): state chip, "Older than the latest edit" chip (`is_stale`), language, expires, frozen at, created by, times opened, Revoke
  (ConfirmDialog) for the link's owner (`created_by.id === me`) or a holder of `cms.pages:update`. A holder of `update` sees every user's links, a reader only their own.
- **The token is never kept.** It lives in the dialog body's React state only: the body is mounted only while the dialog is open (closing drops it), closing is refused
  while the request runs, the mutation has `gcTime: 0` and is `reset()` the moment its answer is copied into state, the list rows have no url, and no query key, toast,
  storage, log or admin-app URL ever sees it. Tests assert the token is absent from the query + mutation caches, `localStorage`, `sessionStorage`, the DOM after close and
  `location`.
- **Unsaved edits**: the link would not include them, so with `isDirty` the dialog warns ("You have unsaved edits that the link will not include") and, when the host has a
  `flush`, offers "Save draft first" (awaits `flush()`, `false` = toast; creating stays possible).
- **Errors** (decided on status / `details` / field-error codes, `classifyPreviewCreateError`): 503 + `details.dependency = "preview.portalUrl"` = "not configured on the
  server"; 422 `limit_exceeded` (body path `""`, `params.max`) = 20 live links; 422 `unknown_reference` at `/locale` (refreshes the language list); 422 `out_of_range` at
  `/ttl_minutes`; 429 = wait `Retry-After` (shown in minutes, Create disabled for that long); 409 `INVALID_STATE` `trashed`; 404; 403. 403 / 429 / 5xx are ALSO toasted by
  `QueryProvider` (same as the cache purge). No `Idempotency-Key` and no `If-Match` (05 12.9.2).
- **Mock** (`mocks/mock-preview.ts`, bound in `handlers.ts`, seeded in `createMockDb`): the three endpoints as strict as the backend (check order: permission, 404, body 422,
  503, locale 422, rate limit, trashed 409, 20-live-links 422; every attempt past the limiter counts toward the 30/h). **Times are wall-clock** (a link lives 30 real
  minutes, `is_stale` = the page's `lock_version` moved), the token is not stored and the list never returns a url; creating pushes a hidden `preview` history row.
  Seeds: page 9 has an active link of Somchai (stale), an expired and a revoked one; **page 8 has 19 active links of mine** (one more is fine, the next is
  `limit_exceeded`). Mock builds only: `window.__MATERM_MOCK__.setPreviewUnconfigured(true|false)` (the 503), `exhaustPreviewRate()` (the next creation is a 429),
  `fillPreviewLinks(pageId, n)`, `previewLinks()` (a summary without any url); `setTranslateOnly(true)` also removes the right to create links.
- **Tests**: `mocks/mock-preview.test.ts`, `components/global/publishing/preview-link-dialog.test.tsx` (over the mock API), `preview-link-errors.test.ts`, and two cases
  in `page-editor.test.tsx` (Preview + unsaved edits + Save draft first; a reader has no button).

## Schema form engine (W2a, T1.2.10)

```tsx
const { data: type } = useSectionType("hero_brand");          // staleTime: Infinity per key@version
const { data: locales } = useLocales();
const form = useSchemaFormState(section.props);                 // value, setValue, isDirty, markSaved, reset + unsaved guard
<SchemaForm ref={handle} sectionType={type} value={form.value} onChange={form.setValue} locales={locales.data}
            mode="draft" /* "publish" for the pre-check */ serverErrors={errors} serverErrorPrefix="/props"
            locale={searchParams.locale} onLocaleChange={...} disabled translateOnly onValidationChange={...} />
```

- **The props object IS the form state** (controlled `value`/`onChange`, no react-hook-form): an edit copies only the
  objects along its JSON-Pointer path (`pointer.ts`), so `FieldRenderer` (memo) skips untouched branches. A cleared field is
  REMOVED (never `""`/`null`), so dirty goes back to false; a boolean with a schema `default` shows it but writes nothing
  until touched. Wait for `useLocales()` before rendering (the default language comes from `is_default`).
- **Widgets** (`compile-field-tree.ts` decides, doc/07 4.2/4.3): `x-localized` -> `LocalizedTextField` (text / textarea)
  or `RichTextField`; `$defs/image` -> `MediaField`; `$defs/link` -> `LinkField`; `x-ref` or `*-picker` -> `EntityField`
  (`EntityPicker` = Popover + cmdk, async); object -> fieldset (optional objects such as a CTA are added/removed as a
  whole); array -> `ArrayField` (`SortableList`: drag handle, keyboard, always-visible up/down, duplicate, remove,
  min/maxItems, a fixed-size list like the 3 collage photos shows all its slots); enum -> radio (<= 6) / select;
  `enum-array` -> checkboxes; unknown shape -> `JsonFallbackField` (read-only, dev warning). `ui:showIf` hides a field but
  keeps its value; problems inside a hidden field are shown with a "clear" button.
- **Language**: `EditorLocaleSwitcher` (editor level, not per field) with completeness badges and issue counts; the
  chosen language is `locale` (controlled for `?locale=`, else internal). "Not translated" badge, fallback text as
  placeholder, "copy from default", compare mode. Inactive languages are not offered; their stored text is kept.
  Completeness = `completeness.ts` (required localized leaves per language, same walker `schema-walker.ts` as the
  publish check); the server decides for real.
- **Validation (`validate.ts`)** reproduces the BACKEND validator (`materm-admin-backend/pkg/contentschema`, rules and
  keyword -> code mapping in its `testdata/README.md`): one Ajv validator per schema (`getSchemaValidator(schema,
  "key@version#hash")`), draft = everything except `required`/`minLength`/`minProperties` (the schema is never edited),
  publish = everything + every required localized leaf non-blank in the default language. The legacy `link.url` pattern is
  replaced by the portable R-016 one (`//host`, `/\host` refused; `link-rules.ts` is the same rule for the widgets and the
  rich-text `href`). The shared suite `fixtures/edge-cases.shared.json` is a verbatim copy of the backend file
  (`edge-cases.test.ts` runs it, and compares it with the backend copy when `../materm-admin-backend` exists - re-copy
  after a change there). The 12 section types + 17 example sections in `fixtures/` are copies of `doc/content-schemas`
  (`fixtures.drift.test.ts` compares them when `../doc` exists).
- **CSP**: Ajv compiles with `new Function`, which the production CSP (no `'unsafe-eval'`, `lib/security/csp.ts`) refuses.
  `createSchemaValidator` then returns `available: false` (the form shows a notice, client validation is off, the server
  still validates on save; editing, completeness and rich text work). Deciding how to get client validation in production
  (precompiled validators per `schema_hash`, or `'unsafe-eval'`) is an open M3 decision; do not loosen the CSP silently.
- **Server errors**: `serverErrors` (the 422 `errors[]`, `serverErrorPrefix` strips e.g. `/props`; keep the array of the
  failed save in state and pass it UNCHANGED - a new array instance is a new batch) become issues keyed by
  pointer; the first one switches language, opens its array item and focuses the field (`SchemaFormHandle.focusFirstIssue()`
  does the same for client issues); an error disappears when its field changes. Text: `schemaForm.issues.<code>` then
  `errors.fields.<code>` then the server's `message`.
- **Rich text** (`components/rich-text/`): stored as the Tiptap/ProseMirror document JSON of doc/04 3.7, never HTML. The
  extension set per profile is explicit (StarterKit's extras are off); output is normalised to the allow-listed attributes
  (no `rel`/`class`/`target: null`); pasted HTML is sanitised; `onChange` never fires on mount or for outside changes;
  `lite` = paragraph, bold, italic, link, lists, line break; `full` adds headings 2-3, quote, lead, and keeps `image` /
  `embed` nodes (inserted by the posts editor, not here). Never render stored HTML with `dangerouslySetInnerHTML`.
- **Lookups** (`data/`): pickers read through `SchemaFormData` (`apiSchemaFormData` over axios by default - the list row
  shapes of doc/05 section 6 are not final, `data/api-data.ts` is the ONE file to adjust; `memorySchemaFormData` for the
  playground). Endpoint names are in `API_ENDPOINTS` (`SECTION_TYPES`, `MEDIA`, `PAGES`, `POSTS`, `ALBUMS`, `CATEGORIES`,
  `FAQ_GROUPS`, `FORMS`).
- **Autosave** (`hooks/use-autosave.ts`): OFF by default (Q-07-7), per-browser preference `useAutosavePreference()`;
  saves after 30 s without edits (`strategy: "debounce"`, default; `"interval"` = every 30 s while dirty, the wording of
  doc/07 C-34), never while `blocked`. The editor passes its own PATCH as `save` and marks the form clean itself.
- **Tests**: `renderSchemaForm(type, props, options)` in `components/schema-form/test-utils.tsx` (stateful host, MSW handlers
  `cmsHandlers` from `src/test/cms-handlers.ts`, `validationDelayMs=0`); tests that render `NavigationGuardProvider`
  (`renderApp`) need `vi.mock("next/navigation")`. `src/test/setup.ts` stubs the DOM measuring Tiptap needs. dnd-kit keyboard
  drag works in jsdom only with stubbed `getBoundingClientRect` (see `sortable-list.test.tsx`); the up/down buttons are
  the primary keyboard path. Real-browser check (Playwright, in a clone) covers drag by keyboard.
