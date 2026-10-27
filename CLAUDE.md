# CLAUDE.md

This file provides guidance to Claude Code when working on this project.

## What this is

`materm-admin-frontend` (Materm Admin) — a Next.js 16 App Router admin/back-office panel:
auth (sign-in, forgot/reset password, accept invitation, profile), the IAM/ops screens (users, roles +
permission matrix, audit log, locales, system status), a protected layout shell and shared infrastructure.
It has no backend of its own; CMS content screens come in later milestones.

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
| Tests | Vitest + Testing Library + MSW (`npm run test`) |

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

Env vars: `.env.development` / `.env.production`, both `NEXT_PUBLIC_API_BASE_URL` only — no
secrets in this layer.

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
