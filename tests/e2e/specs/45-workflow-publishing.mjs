// The publishing workflow against the REAL backend (phases C + D): review (submit, queue, reject with a comment, resubmit, approve), schedule (dialog, queue,
// calendar, cancel), the scheduler firing a due action (made due with SQL on the SCRATCH database, no sleeping for minutes), apply_revision of a published
// page, and two evidence probes (publish DRY RUN on a `scheduled` entity; discard of a draft that has a pending apply_revision booking).
// Needs the scheduler tick (15 s). Scratch infra only: the SQL helper refuses any database whose name is not `materm_e2e_*`.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launch, suite, ok, eq, session, open, api, rootToken, newUser, TAG, shot, PORTAL_FE, env, sleep } from '../lib.mjs';

const t = suite('45 workflow publishing');
const root = await rootToken();
const author = await newUser(root, 'author'); const editor = await newUser(root, 'editor');
const b = await launch();
const A = await session(b, { user: author.username, pass: author.password });
const E = await session(b, { user: editor.username, pass: editor.password });
t.page = E.page;
const idem = () => ({ 'idempotency-key': crypto.randomUUID() });
const toast = (pg, re) => pg.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 10000 });
const body = (text) => ({ type: 'doc', content: [{ type: 'lead', content: [{ type: 'text', text }] }, { type: 'paragraph', content: [{ type: 'text', text }] }] });
const mediaIds = (await api(root, 'GET', '/media/assets?limit=24')).body.data.filter((m) => m.kind === 'image').map((m) => m.id);
const portal = async (p) => { const r = await fetch(PORTAL_FE + p, { headers: { 'cache-control': 'no-cache' } }); return { status: r.status, html: await r.text() }; };

// ---- scratch SQL (read + write), refused on anything but the throw-away e2e database
if (!/^materm_e2e_/.test(env.E2E_DB || '')) throw new Error('refusing to run: not the e2e scratch database');
const sql = (q) => execFileSync('docker', ['exec', '-i', 'materm-scratch-pg', 'psql', '-U', 'materm_scratch', '-d', env.E2E_DB, '-t', '-A', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
const timings = {};

// ---- helpers
const makePost = async (title) => {
  const r = await api(author.token, 'POST', '/posts', { translations: { la: { title } } }, idem()); ok(r.status === 201, 'create post ' + r.status);
  const id = r.body.data.id; const cur = await api(author.token, 'GET', `/posts/${id}`);
  const up = await api(author.token, 'PATCH', `/posts/${id}`, { category_id: 1, hero_media_id: mediaIds[0], translations: { la: { excerpt: 'Excerpt ' + title, seo_title: 'SEO ' + title, body: body('Body ' + title) }, en: { title: title + ' EN', excerpt: 'Excerpt EN', seo_title: 'SEO EN', body: body('Body EN ' + title) } } }, { 'if-match': cur.etag });
  ok(up.status === 200, 'complete post ' + up.status + ' ' + JSON.stringify(up.body?.errors || ''));
  const fin = await api(author.token, 'GET', `/posts/${id}`);
  return { id, slug: fin.body.data.translations.la.slug, title };
};
const postState = async (id) => { const r = await api(root, 'GET', `/posts/${id}`); return { status: r.body.data.status, etag: r.etag, schedule: r.body.data.schedule ?? null, scheduled_at: r.body.data.scheduled_at ?? null, data: r.body.data }; };
const chipState = (pg) => pg.getByTestId('publish-bar').getByTestId('status-badge').first().getAttribute('data-state');
const waitChip = async (pg, state) => { const t0 = Date.now(); let s; while (Date.now() - t0 < 12000) { s = await chipState(pg).catch(() => null); if (s === state) return; await sleep(300); } throw new Error(`status chip ${s} != ${state}`); };
// Vientiane wall-clock of an instant: yyyy-MM-dd and HH:mm
const vte = (ms) => { const d = new Date(ms + 7 * 3600e3).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16) }; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Picks date + time in the DateTimeField popover of the open schedule dialog.
const pickTime = async (pg, ms) => {
  const { date, time } = vte(ms); const [y, m, d] = date.split('-').map(Number);
  const dlg = pg.getByTestId('schedule-dialog');
  await dlg.getByRole('button', { name: 'Go live at' }).click();
  const pop = pg.locator('[data-slot=popover-content]').last();
  await pop.getByRole('button', { name: new RegExp(`${MONTHS[m - 1]} ${d}(st|nd|rd|th), ${y}`) }).first().click();
  await pop.locator('input[type=time]').fill(time);
  await pop.getByRole('button', { name: 'Done' }).click();
};
const waitFor = async (fn, ms, step = 1000) => { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last) return { value: last, ms: Date.now() - t0 }; await sleep(step); } return { value: null, ms: Date.now() - t0 }; };
const queueApi = async (token, qs = '') => (await api(token, 'GET', '/publishing/queue' + (qs ? '?' + qs : '')));

const P1 = await makePost('E2E review post ' + TAG);
const P2 = await makePost('E2E schedule post ' + TAG);

// =========================================================== (1) author submits for review
await t.step('(1) author: submits the post for review (button + dialog), the status becomes In review and the author cannot edit it (BR-10)', async () => {
  await open(A.page, '/admin/blog/posts/' + P1.id);
  await A.page.getByRole('button', { name: 'Save draft' }).waitFor();
  await A.page.getByTestId('publish-bar').getByRole('button', { name: 'Submit for review' }).click();
  const dlg = A.page.getByTestId('submit-review-dialog'); await dlg.getByRole('textbox').fill('Please check the excerpt');
  await dlg.getByRole('button', { name: 'Submit for review' }).click();
  await waitChip(A.page, 'in_review');
  eq((await postState(P1.id)).status, 'in_review', 'server status');
  await A.page.waitForTimeout(800);
  const locked = await A.page.getByText(/is in review, so you cannot edit it/).count(); ok(locked > 0, 'locked notice');
  ok(await A.page.getByRole('button', { name: 'Save draft' }).isHidden().catch(() => true) || await A.page.getByRole('button', { name: 'Save draft' }).isDisabled(), 'Save draft hidden or disabled');
  ok(await A.page.locator('[id^="post-field-title"]').first().isDisabled(), 'title is read-only');
  const cur = await api(author.token, 'GET', `/posts/${P1.id}`);
  const patch = await api(author.token, 'PATCH', `/posts/${P1.id}`, { translations: { la: { excerpt: 'sneaky edit' } } }, { 'if-match': cur.etag });
  t.note('BR-10 author PATCH while in review ->', patch.status, patch.body?.code);
  eq(patch.status, 403, 'author PATCH of an in_review post');
  return { patchStatus: patch.status, code: patch.body?.code };
});

// =========================================================== (2) editor queue -> reject with a comment
const COMMENT = 'Needs a better excerpt ' + TAG;
await t.step('(2) editor: sees the post under Awaiting review (badge + queue), opens it from the queue and REJECTS it with a comment', async () => {
  await open(E.page, '/admin/publishing');
  const badge = E.page.locator('[data-testid=nav-badge][data-query="publishing.awaiting"]');
  await badge.waitFor({ timeout: 10000 }); ok(Number((await badge.innerText()).replace(/\D/g, '')) >= 1, 'sidebar badge counts it');
  eq(await E.page.getByTestId('tab-awaiting_review').getAttribute('aria-selected'), 'true', 'default tab');
  const row = E.page.getByTestId('queue-row').filter({ hasText: P1.title }); await row.waitFor({ timeout: 10000 });
  ok(/Post/.test(await row.innerText()) && /In review/.test(await row.innerText()), 'kind and status in the row');
  ok(await row.getByTestId('approve-hint').count() === 1, 'approve hint for a reviewer');
  await shot(E.page, '45-queue-awaiting');
  const aw = (await queueApi(editor.token, 'tab=awaiting_review')).body.data.awaiting_review.items.find((r) => r.id === P1.id && r.entity_type === 'posts');
  ok(aw, 'API row'); eq(aw.status, 'in_review', 'row status'); ok(aw.submitted_at && aw.submitted_by?.id, 'submitted_at / submitted_by: ' + JSON.stringify([aw.submitted_at, aw.submitted_by]));
  ok(aw.can.read && aw.can.review && aw.can.publish && aw.can.schedule && aw.can.update, 'editor can{} ' + JSON.stringify(aw.can)); ok(!('collection_key' in aw), 'no collection_key on a post');
  await row.getByRole('link', { name: /^Open / }).click();
  await E.page.waitForURL(new RegExp('/admin/blog/posts/' + P1.id));
  await E.page.getByTestId('publish-bar').getByRole('button', { name: /Reject/ }).click();
  const dlg = E.page.getByRole('dialog'); await dlg.getByRole('textbox').fill(COMMENT);
  await dlg.getByRole('button', { name: 'Send back' }).click();
  await waitChip(E.page, 'draft');
  eq((await postState(P1.id)).status, 'draft', 'server status after reject');
});

await t.step('(2b) the rejection comment is visible in the History tab; the queue no longer lists the post', async () => {
  await E.page.getByRole('tab', { name: 'History' }).click();
  await E.page.getByText(COMMENT).first().waitFor({ timeout: 10000 });
  await open(E.page, '/admin/publishing');
  await E.page.getByTestId('queue-empty').or(E.page.getByTestId('queue-row')).first().waitFor({ timeout: 10000 });
  eq(await E.page.getByTestId('queue-row').filter({ hasText: P1.title }).count(), 0, 'row gone');
});

await t.step('(2c) contract: GET /publishing/queue answers the documented shape for the editor and gates by permission', async () => {
  const q = await queueApi(editor.token); eq(q.status, 200, 'status');
  eq(Object.keys(q.body.data).sort().join(), 'awaiting_review,scheduled,unpublished_changes', 'three tabs');
  for (const k of ['awaiting_review', 'scheduled', 'unpublished_changes']) ok(typeof q.body.data[k].count === 'number' && Array.isArray(q.body.data[k].items), k + ' {count, items}');
  const one = (await queueApi(editor.token, 'tab=unpublished_changes&limit=1')).body.data; eq(Object.keys(one).join(), 'unpublished_changes', 'only the asked tab');
  const row = one.unpublished_changes.items[0]; if (row) ok(row.entity_type && row.id && row.can && 'draft_updated_at' in row, 'row fields ' + JSON.stringify(Object.keys(row))); else t.note('no unpublished change on the scratch DB yet (checked again in step 6)');
  const bad = await queueApi(editor.token, 'tab=nope'); eq(bad.status, 422, 'bad tab is 422');
  const to = encodeURIComponent(new Date(Date.now() + 86400e3).toISOString().replace('Z', '+00:00')); eq((await queueApi(editor.token, 'tab=scheduled&to=' + to)).status, 200, '`to` with a percent-encoded offset');
  const far = encodeURIComponent(new Date(Date.now() + 40 * 86400e3).toISOString()); const farR = await queueApi(editor.token, 'tab=scheduled&to=' + far); t.note('`to` beyond 30 days ->', farR.status, farR.body?.errors?.[0]?.code); eq(farR.status, 422, '`to` > now+30d');
  const a = await queueApi(author.token); eq(a.status, 200, 'author may call it');
  ok(a.body.data.awaiting_review.items.every((r) => r.can.review === false), 'the author can not review');
  return { editorUnpublished: q.body.data.unpublished_changes.count };
});

// =========================================================== (3) resubmit, approve by publishing
await t.step('(3) author resubmits; editor approves from the queue by publishing; the post is on the website within the NFR-03 budget', async () => {
  await open(A.page, '/admin/blog/posts/' + P1.id);
  await A.page.getByTestId('publish-bar').getByRole('button', { name: 'Submit for review' }).click();
  await A.page.getByTestId('submit-review-dialog').getByRole('button', { name: 'Submit for review' }).click();
  await waitChip(A.page, 'in_review');
  await open(E.page, '/admin/publishing');
  const row = E.page.getByTestId('queue-row').filter({ hasText: P1.title }); await row.waitFor({ timeout: 10000 });
  await row.getByRole('link', { name: /^Open / }).click();
  await E.page.waitForURL(new RegExp('/admin/blog/posts/' + P1.id));
  await E.page.getByTestId('publish-bar').getByRole('button', { name: /^Publish$/ }).click();
  const dlg = E.page.getByRole('dialog'); await dlg.getByRole('button', { name: /^Publish$/ }).click();
  await toast(E.page, /published/i);
  const seen = await waitFor(async () => { const r = await portal('/blog/' + P1.slug); return r.status === 200 && r.html.includes(P1.title) ? r : null; }, 20000, 400);
  ok(seen.value, 'post visible on the website'); timings.reviewPublishToVisibleMs = seen.ms;
  eq((await postState(P1.id)).status, 'published', 'server status');
  return { visibleMs: seen.ms };
});

// =========================================================== (4) schedule through the dialog
let target;
await t.step('(4) editor: schedules the second post for now+2 min through the dialog; it is in the Scheduled tab and calendar, NOT on the website', async () => {
  await open(E.page, '/admin/blog/posts/' + P2.id);
  await E.page.getByTestId('publish-bar').getByRole('button', { name: /^Schedule/ }).click();
  // the publish dry run runs first; its blockers would open a different dialog
  await E.page.getByTestId('schedule-dialog').waitFor({ timeout: 10000 });
  target = Date.now() + 130e3; await pickTime(E.page, target);
  await E.page.getByTestId('schedule-dialog').getByRole('button', { name: /^Schedule$/ }).click();
  await waitChip(E.page, 'scheduled');
  const s = await postState(P2.id); eq(s.status, 'scheduled', 'server status'); eq(s.schedule?.action, 'publish', 'action');
  ok(Math.abs(Date.parse(s.schedule.run_at) - target) < 61e3, 'run_at is the picked minute: ' + s.schedule.run_at);
  await open(E.page, '/admin/publishing?tab=scheduled');
  const row = E.page.getByTestId('queue-row').filter({ hasText: P2.title }); await row.waitFor({ timeout: 10000 });
  ok(/Scheduled/.test(await row.innerText()), 'scheduled chip');
  const item = E.page.getByTestId('calendar-item').filter({ hasText: P2.title }); await item.waitFor({ timeout: 5000 });
  eq(await item.getAttribute('href'), '/admin/blog/posts/' + P2.id, 'calendar link');
  const day = vte(target).date; const cell = E.page.locator(`[data-testid=calendar-day][data-date="${day}"]`); ok(Number(await cell.getAttribute('data-count')) >= 1, 'calendar day ' + day);
  await shot(E.page, '45-queue-scheduled');
  const sr = (await queueApi(editor.token, 'tab=scheduled')).body.data.scheduled.items.find((r) => r.id === P2.id && r.entity_type === 'posts');
  ok(sr && sr.overdue === false && sr.schedule?.action === 'publish' && sr.schedule?.status === 'pending' && sr.run_at, 'scheduled row ' + JSON.stringify(sr && [sr.run_at, sr.overdue, sr.schedule]));
  const r = await portal('/blog/' + P2.slug); eq(r.status, 404, 'not visible on the website yet');
});

await t.step('(4b) Cancel schedule returns the post to draft and it leaves the queue', async () => {
  await open(E.page, '/admin/blog/posts/' + P2.id);
  await E.page.getByTestId('publish-bar').getByRole('button', { name: 'Cancel schedule' }).click();
  await E.page.getByRole('alertdialog').getByRole('button', { name: 'Cancel schedule' }).click();
  await waitChip(E.page, 'draft');
  eq((await postState(P2.id)).status, 'draft', 'server status'); eq((await postState(P2.id)).schedule, null, 'no schedule member');
  const q = (await queueApi(editor.token, 'tab=scheduled')).body.data.scheduled; ok(!q.items.some((r) => r.id === P2.id && r.entity_type === 'posts'), 'left the queue');
  eq(sql(`select count(*) from ops_scheduled_actions where entity_type='cms.posts' and entity_id=${P2.id} and status='pending'`), '0', 'no pending action row');
  eq(sql(`select status from ops_scheduled_actions where entity_type='cms.posts' and entity_id=${P2.id} order by id desc limit 1`), 'cancelled', 'action row cancelled');
});

// =========================================================== (7) dry run on a scheduled entity (before the fire)
await t.step('(7) REAL backend: publish DRY RUN on a `scheduled` post (what the UI Reschedule path runs first) + the Reschedule dialog in the UI', async () => {
  const cur = await postState(P2.id);
  const sc = await api(editor.token, 'POST', `/posts/${P2.id}/schedule`, { scheduled_at: new Date(Date.now() + 10 * 60e3).toISOString() }, { 'if-match': cur.etag, ...idem() }); eq(sc.status, 200, 'schedule 10 min');
  const dry = await api(editor.token, 'POST', `/posts/${P2.id}/publish?dry_run=true`, undefined, { 'if-match': sc.etag });
  t.note('DRY RUN on a scheduled post ->', dry.status, JSON.stringify(dry.body).slice(0, 300));
  timings.dryRunOnScheduled = { status: dry.status, code: dry.body?.code, body: dry.body };
  await open(E.page, '/admin/blog/posts/' + P2.id);
  await E.page.getByTestId('publish-bar').getByRole('button', { name: /Reschedule/ }).click();
  const opened = await E.page.getByTestId('schedule-dialog').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  timings.rescheduleDialogOpened = opened;
  t.note('Reschedule dialog opened in the UI:', opened);
  if (opened) await E.page.keyboard.press('Escape');
  const after = await postState(P2.id); eq(after.status, 'scheduled', 'still scheduled (dry run changed nothing)');
  ok(dry.status === 200 || dry.status === 409 || dry.status === 422, 'recorded: ' + dry.status);
  return { dryRunStatus: dry.status, code: dry.body?.code, rescheduleDialog: opened };
});

// =========================================================== (5) due -> the scheduler publishes
await t.step('(5) make the booking due with SQL (scratch DB), wait for the scheduler tick: Published, on the website, gone from the queue', async () => {
  const s = await postState(P2.id); eq(s.status, 'scheduled', 'is scheduled');
  const q0 = (await queueApi(editor.token, 'tab=scheduled')).body.data.scheduled; ok(q0.items.some((r) => r.id === P2.id), 'in the queue before');
  sql(`update cms_posts set scheduled_at = now() - interval '2 minutes' where id=${P2.id} and status='scheduled'`);
  sql(`update ops_scheduled_actions set run_at = now() - interval '2 minutes' where entity_type='cms.posts' and entity_id=${P2.id} and status='pending'`);
  const due = Date.now(); timings.dueAt = new Date(due).toISOString();
  const row = (await queueApi(editor.token, 'tab=scheduled')).body.data.scheduled.items.find((r) => r.id === P2.id);
  t.note('queue row right after making it due: overdue =', row?.overdue, 'run_at =', row?.run_at);
  const pub = await waitFor(async () => (await postState(P2.id)).status === 'published', 60000, 1000);
  ok(pub.value, 'scheduler did not publish within 60 s');
  timings.dueToPublishedMs = pub.ms; const tPub = Date.now();
  const seen = await waitFor(async () => { const r = await portal('/blog/' + P2.slug); return r.status === 200 && r.html.includes(P2.title) ? r : null; }, 30000, 300);
  ok(seen.value, 'post visible on the website'); timings.publishedToVisibleMs = Date.now() - tPub; timings.dueToVisibleMs = Date.now() - due;
  const q = (await queueApi(editor.token, 'tab=scheduled')).body.data.scheduled; ok(!q.items.some((r) => r.id === P2.id && r.entity_type === 'posts'), 'left the queue');
  eq(sql(`select status from ops_scheduled_actions where entity_type='cms.posts' and entity_id=${P2.id} and action='publish' order by id desc limit 1`), 'done', 'action row done');
  await open(E.page, '/admin/publishing?tab=scheduled'); await E.page.getByTestId('queue-empty').or(E.page.getByTestId('queue-row')).first().waitFor({ timeout: 10000 });
  eq(await E.page.getByTestId('queue-row').filter({ hasText: P2.title }).count(), 0, 'not listed in the UI either');
  t.note('NFR-03: due -> status Published', timings.dueToPublishedMs, 'ms; Published -> visible on the website', timings.publishedToVisibleMs, 'ms; due -> visible', timings.dueToVisibleMs, 'ms');
  return { dueToPublishedMs: timings.dueToPublishedMs, publishedToVisibleMs: timings.publishedToVisibleMs, dueToVisibleMs: timings.dueToVisibleMs };
});

// =========================================================== (6) apply_revision on a published page
const PATH = '/e2e-wf-' + TAG; const TL = 'E2E_WF_TITLE_' + TAG; const TL2 = TL + '_NEXT';
let pageId;
await t.step('(6) setup: a published page (created and published in the UI like spec 30)', async () => {
  const page = E.page;
  await open(page, '/admin/pages');
  await page.getByRole('button', { name: /new page/i }).click();
  const dlg = page.getByRole('dialog'); const ins = dlg.locator('input');
  await ins.nth(0).fill('E2E wf page ' + TAG); await ins.nth(1).fill(PATH);
  await dlg.getByRole('button', { name: 'Create page' }).click();
  await page.waitForURL(/\/admin\/pages\/\d+/, { timeout: 15000 });
  pageId = Number(new URL(page.url()).pathname.split('/').pop());
  // the blockers dialog + "Go to field" is how spec 30 reaches the hero editor
  await page.getByRole('button', { name: /^Publish$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Go to field' }).first().waitFor({ timeout: 10000 });
  const gotos = page.getByRole('button', { name: 'Go to field' }); await gotos.nth((await gotos.count()) - 1).click();
  await page.waitForTimeout(1500);
  await page.locator('textarea[id$="_title_la"]').first().fill(TL);
  await page.getByRole('button', { name: 'Choose image' }).click();
  await page.getByRole('button', { name: 'hero-bg-forest.jpg' }).first().click();
  await page.locator('input[id$="_background_alt_la"]').fill('E2E hero alt');
  await page.getByRole('radio', { name: /^EN/i }).first().click();
  await page.locator('textarea[id$="_title_en"]').first().fill(TL + '_EN');
  await page.getByRole('button', { name: 'Save section' }).click(); await page.waitForTimeout(2000);
  await page.getByRole('tab', { name: 'SEO' }).click();
  await page.locator('#page-field-seo_title-la').fill('E2E SEO ' + TAG);
  await page.getByRole('button', { name: 'Save draft' }).click(); await page.waitForTimeout(1800);
  await page.getByRole('tab', { name: 'Content' }).click();
  await page.getByRole('button', { name: /^Publish$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Publish$/ }).click(); await toast(page, /published/i);
  const seen = await waitFor(async () => { const r = await portal(PATH); return r.status === 200 && r.html.includes(TL) ? r : null; }, 25000, 400); ok(seen.value, 'page is on the website');
});

await t.step('(6) apply_revision: edit the published page (draft), schedule the CHANGE through the dialog, make it due with SQL: the draft goes live', async () => {
  const page = E.page; // still on the page editor of the setup step (spec 30 edits in place the same way)
  await page.getByRole('radio', { name: /^LAO/i }).first().click();
  await page.locator('textarea[id$="_title_la"]').first().fill(TL2);
  await page.getByRole('button', { name: 'Save section' }).click(); await page.waitForTimeout(1800);
  await page.getByTestId('publish-bar').getByRole('button', { name: /Schedule changes/ }).click();
  await page.getByTestId('schedule-dialog').waitFor({ timeout: 10000 });
  const target2 = Date.now() + 130e3; await pickTime(page, target2);
  await page.getByTestId('schedule-dialog').getByRole('button', { name: /^Schedule changes$/ }).click();
  const t0 = Date.now(); let st; while (Date.now() - t0 < 10000) { const r = await api(root, 'GET', `/pages/${pageId}`); st = r.body.data; if (st.schedule) break; await sleep(400); }
  eq(st.status, 'published', 'the page stays published'); eq(st.schedule?.action, 'apply_revision', 'action'); eq(st.has_unpublished_changes, true, 'has a draft');
  ok(/Changes go live at/.test(await page.getByTestId('schedule-status').innerText()), 'bar line "Changes go live at"');
  const chg = (await queueApi(editor.token, 'tab=unpublished_changes')).body.data.unpublished_changes.items.find((r) => r.id === pageId && r.entity_type === 'pages');
  ok(chg && chg.draft_updated_at && chg.draft_updated_by?.id && chg.status === 'published', 'unpublished_changes row ' + JSON.stringify(chg && Object.keys(chg)));
  const scr = (await queueApi(editor.token, 'tab=scheduled')).body.data.scheduled.items.find((r) => r.id === pageId && r.entity_type === 'pages');
  ok(scr && scr.schedule?.action === 'apply_revision' && scr.status === 'published', 'scheduled apply_revision row ' + JSON.stringify(scr && [scr.status, scr.schedule]));
  await open(page, '/admin/publishing?tab=scheduled');
  const row = page.getByTestId('queue-row').filter({ hasText: 'E2E wf page' }); await row.waitFor({ timeout: 10000 });
  ok(/Publishes the edited version/.test(await row.innerText()), 'apply_revision wording: ' + (await row.innerText()).replace(/\s+/g, ' '));
  await shot(page, '45-queue-apply-revision');
  eq((await portal(PATH)).html.includes(TL2), false, 'website still shows the old title');
  sql(`update ops_scheduled_actions set run_at = now() - interval '2 minutes' where entity_type='cms.pages' and entity_id=${pageId} and action='apply_revision' and status='pending'`);
  const due = Date.now();
  const pub = await waitFor(async () => { const r = await api(root, 'GET', `/pages/${pageId}`); return r.body.data.has_unpublished_changes === false && !r.body.data.schedule; }, 60000, 1000); ok(pub.value, 'scheduler applied the draft within 60 s');
  const tPub = Date.now(); const seen = await waitFor(async () => { const r = await portal(PATH); return r.status === 200 && r.html.includes(TL2) ? r : null; }, 30000, 300); ok(seen.value, 'new title on the website');
  timings.applyDueToAppliedMs = pub.ms; timings.applyAppliedToVisibleMs = Date.now() - tPub; timings.applyDueToVisibleMs = Date.now() - due;
  t.note('apply_revision: due -> applied', pub.ms, 'ms; applied -> visible', timings.applyAppliedToVisibleMs, 'ms');
  eq(sql(`select status from ops_scheduled_actions where entity_type='cms.pages' and entity_id=${pageId} and action='apply_revision' order by id desc limit 1`), 'done', 'action row done');
  const q = (await queueApi(editor.token)).body.data; ok(!q.scheduled.items.some((r) => r.id === pageId && r.entity_type === 'pages'), 'left the scheduled tab'); ok(!q.unpublished_changes.items.some((r) => r.id === pageId && r.entity_type === 'pages'), 'left the unpublished changes tab');
});

// =========================================================== (8) discard of a draft with a pending apply_revision booking
await t.step('(8) REAL backend: what happens to a pending apply_revision booking when the draft is discarded', async () => {
  const get = async () => (await api(root, 'GET', `/pages/${pageId}`));
  let r = await get();
  const sec = (await api(root, 'GET', `/pages/${pageId}/sections?include=props`)).body.data[0];
  const props = JSON.parse(JSON.stringify(sec.props)); props.title.la = TL + '_DISCARD';
  const upd = await api(root, 'PATCH', `/pages/${pageId}/sections/${sec.id}`, { props }, { 'if-match': (await api(root, 'GET', `/pages/${pageId}/sections/${sec.id}`)).etag });
  t.note('draft edit ->', upd.status);
  r = await get(); eq(r.body.data.has_unpublished_changes, true, 'draft exists');
  const sc = await api(root, 'POST', `/pages/${pageId}/schedule`, { scheduled_at: new Date(Date.now() + 10 * 60e3).toISOString() }, { 'if-match': r.etag, ...idem() }); eq(sc.status, 200, 'schedule changes');
  const rowBefore = sql(`select id, status from ops_scheduled_actions where entity_type='cms.pages' and entity_id=${pageId} and action='apply_revision' order by id desc limit 1`);
  const dis = await api(root, 'POST', `/pages/${pageId}/discard-draft`, undefined, { 'if-match': sc.etag });
  t.note('discard-draft with a pending booking ->', dis.status, dis.body?.code || '');
  const rowAfter = sql(`select id, status from ops_scheduled_actions where entity_type='cms.pages' and entity_id=${pageId} and action='apply_revision' order by id desc limit 1`);
  const after = (await get()).body.data;
  timings.discard = { status: dis.status, code: dis.body?.code, rowBefore, rowAfter, scheduleMember: after.schedule, hasUnpublishedChanges: after.has_unpublished_changes };
  t.note('booking row before', rowBefore, 'after', rowAfter, '; detail.schedule =', JSON.stringify(after.schedule));
  eq(dis.status, 200, 'discard answered 200'); eq(after.schedule ?? null, null, 'no schedule member after discard');
  ok(/\|cancelled$/.test(rowAfter), 'the booking row is cancelled: ' + rowAfter);
  const q = (await queueApi(editor.token, 'tab=scheduled')).body.data.scheduled; ok(!q.items.some((x) => x.id === pageId && x.entity_type === 'pages'), 'the queue no longer lists it');
  return timings.discard;
});

await t.step('no 5xx / page errors in the author or editor sessions', async () => {
  for (const S of [A, E]) { const bad = S.sink.http.filter((h) => h.status >= 500); ok(bad.length === 0, JSON.stringify(bad)); const pe = S.sink.console.filter((c) => c.startsWith('PAGEERROR')); ok(pe.length === 0, pe.join(' | ')); }
});
t.note('TIMINGS', JSON.stringify(timings));
await t.done(b);
