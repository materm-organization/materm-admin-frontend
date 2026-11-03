# Admin E2E suite (real backend, no mocks)

Drives a **production build** of this repo in system Chrome (`playwright-core`) against the real admin backend, portal backend and portal
frontend, all started on scratch infrastructure by the scripts of `../../../e2e-cross-system/` (used as they are, never edited). Not part of
`npm test` (Vitest excludes `tests/e2e`).

## Run
```bash
(cd ../materm-admin-backend && make testdb-up)   # scratch Postgres 55433 + Redis 56380 (once)
npm run e2e                                      # up + all specs + tear down (also when a spec fails)
tests/e2e/run.sh up                              # only build + start the stack  (about 4 min: two `next build`s)
SPEC=30 tests/e2e/run.sh test                    # only specs whose file name starts with 30
XFLOWS="55 80" tests/e2e/run.sh test             # also the cross-system flows 55 (preview-link UI) and 80 (M5, notifier mail)
tests/e2e/run.sh down                            # stop servers, drop the throw-away DB + role, delete the temp dir
KEEP=1 npm run e2e                               # leave the stack up
```
Needs: Docker (scratch containers), Go, Node, `rsync`, Google Chrome at `/Applications/Google Chrome.app`, and the sibling repos
(`materm-admin-backend`, `materm-web-portal-backend`, `materm-web-portal-frontend`, `e2e-cross-system`). `playwright-core` is installed into the
stack's temp dir, not into this repo. The stack is built from HEAD clones **plus the working tree of this repo** (uncommitted fixes are tested).
Ports (fixed by `e2e-cross-system/lib/common.sh`): admin backend 3201, portal backend 3202, admin frontend 3203, portal frontend 3204, Redis
proxy 56390. Only one stack at a time (`e2e-cross-system/.work-path`). Never touches 5432 / 6379 / 3000-3002 / 8080 / 3210 or the `materm` DB.

## Specs (`specs/*.mjs`, run in file order; each creates its own users / records, so reruns on the same stack work)
| Spec | Covers |
|---|---|
| 00-auth | wrong password, protected-route redirect, forced password change, sign-out, session expiry (revoked sessions), forgot-password neutrality |
| 10-users-roles | users (temporary-password + invite, edit, deactivate / activate, role filter, History), roles + matrix (review dialog, 409 conflict in two tabs, system role read-only), locales, system + cache purge dialog, audit filter + drawer |
| 20-save-live | settings (+ History, 409 in two tabs), SEO, UI strings (+ History), categories, tags, menus (add / move / delete), media metadata |
| 30-pages | create from template, publish blockers + Go to field, SchemaForm hero fill + image picker, SEO tab, publish, edit -> draft, discard, History restore as draft, add section, preview link, unpublish, trash |
| 40-posts-albums-faq | author vs editor rights on posts (no Publish, 403, read-only on others' posts), editor publish + draft edit, galleries (pictures, publish, referenced 409), FAQ (question + answer, publish) |
| 50-forms-inbox-dashboard | recipients, public contact form -> inbox, open -> read, note, replied, archive, bulk, spam, CSV export (BOM), form History, dashboard per role |
| 60-permission-modes | viewer read-only, translator text-only, editor without iam, API 403s, not-found route |
| 70-redirects-import-authors | redirects CSV import (dry run with a row error, apply, update with previous value, export -> import all `unchanged`, refused apply 422 `details.report`); authors (create, assign in the post editor, delete blocked `author_has_posts`, switched-off author 422, trash / restore, Versions + Activity tabs, duplicate account link 409). Uses a fresh editor: the import limit is 20 per hour per user and dry runs count |

Not covered here (covered by the cross-system flows, run with `XFLOWS`): preview-link 20-cap + Lao message + unsaved-edit warning (55), notifier mail /
outbox (80), Redis outage and cache timings (60, 70), portal propagation latency (30, 40, 45).

Screenshots of failing steps and a few evidence shots land in `tests/e2e/results/` (git-ignored); every spec also writes `results/<name>.json`.
Secrets are random per run and never printed.
