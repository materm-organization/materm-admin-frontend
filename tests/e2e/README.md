# Admin E2E suite (real backend, no mocks)

Drives a **production build** of this repo in system Chrome (`playwright-core`) against the real admin backend, portal backend and portal
frontend, all started on scratch infrastructure by the scripts of `../../../e2e-cross-system/` (used as they are, except one scratch-only line: `export SECURITY_WEBHOOKSECRETKEY=...` in `02-backends.sh` and `05-restart-admin.sh`, a throw-away key the webhooks spec needs). Not part of
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
| 45-workflow-publishing | publishing workflow + SCR-39 queue: author submits for review (BR-10 lock), editor sees it in the queue (badge, tabs), rejects with a comment (History), resubmit + publish, schedule through the dialog (queue, calendar, not on the website, Cancel schedule), a due booking made due with SQL on the scratch DB and fired by the scheduler (NFR-03 timings), apply_revision of a published page, queue API contract, evidence probes (publish dry run on a scheduled post, discard of a draft with a pending booking). Needs the 15 s scheduler tick |
| 46-hero-video | hero background VIDEO end to end (release 3): synthetic MP4 + PNG uploaded to a fake file service (port 3205; admin backend restarted with `FILE_*`, portal backend with `MEDIA_BASE_URL` through `tests/e2e/restart-portal.sh`), the new video control in the page editor, 422 `kind_mismatch` at both pointers (API + editor message), publish, portal API media map (`kind: video`, `duration_ms`, `bytes`, mime) and the portal HTML `<video muted loop playsinline poster>` without `controls`, delete refused 409 `MEDIA_IN_USE`, remove the video and publish again (no `<video>`). Does not assert playback (synthetic MP4). `run.sh up` also overlays the working trees of the portal backend / frontend (`OVERLAY_PORTAL=0` = HEAD only) |
| 50-forms-inbox-dashboard | recipients, public contact form -> inbox, open -> read, note, replied, archive, bulk, spam, CSV export (BOM), form History, dashboard per role |
| 60-permission-modes | viewer read-only, translator text-only, editor without iam, API 403s, not-found route |
| 70-redirects-import-authors | redirects CSV import (dry run with a row error, apply, update with previous value, export -> import all `unchanged`, refused apply 422 `details.report`); authors (create, assign in the post editor, delete blocked `author_has_posts`, switched-off author 422, trash / restore, Versions + Activity tabs, duplicate account link 409). Uses a fresh editor: the import limit is 20 per hour per user and dry runs count |
| 80-webhooks | external webhooks (super_admin only): create refusals (http, private / metadata / loopback address, localhost, port, credentials), create with a public IP literal switched off, the one-time secret, edit with If-Match from `etag`, 409 in two views, rotate, list filters, Test dialog opened (never run), deliveries drawer, History, delete, admin / viewer denied. Needs `SECURITY_WEBHOOKSECRETKEY` in the harness. No real delivery |
| 90-collections | collections (SCR-40 / 41): create through the field builder (stored schemas are the allowed subset), a $ref stopped by the client check, a pattern-cost refusal from the server shown as readable lines, API refusals, entries in two languages, publish with a duplicate-slug blocker, a schema change blocked by entries (409 `schema_breaks_entries` dialog + API) and the same change made compatible, delete refused while entries exist, restore of the old schema refused, entry history, trash / restore, IDOR, editor / viewer / author / translator rights |
| 95-shared-sections | shared sections (SCR-22 + the shared parts of SCR-20): create in the UI (201 + ETag), fill and save with the shared ETag, rename, place in two pages from the Shared tab of the picker (warning for a draft), the page publish blocked while the shared section is a draft (blocker, Open shared section link, Go to field), publish the shared section then both pages, edit the source and publish (the confirmation lists the 2 live pages, `Used in 2 pages` and the usages sheet), unpublish (confirmation with the pages, warning notice, next page publish blocked, hidden reference skipped), delete disabled while used + 409 `shared_section_in_use` with rows (API and a stale-screen dialog), the page-side API rules (`not_applicable`, `not_in_enum`, `unknown_reference`, `shared_in_required_slot`, `placeable_on_page`, immutable type), detach (UI, idempotent API, `If-Match` 428), delete / trash / restore, IDOR, editor / viewer / author / translator rights. **Not run yet**: written against doc/05 section 18 before the backend module existed |

Not covered here (covered by the cross-system flows, run with `XFLOWS`): preview-link 20-cap + Lao message + unsaved-edit warning (55), notifier mail /
outbox (80), Redis outage and cache timings (60, 70), portal propagation latency (30, 40, 45).

Screenshots of failing steps and a few evidence shots land in `tests/e2e/results/` (git-ignored); every spec also writes `results/<name>.json`.
Secrets are random per run and never printed.
