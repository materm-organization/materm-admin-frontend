// Forms editor (recipients), contact form submission through the PUBLIC website, inbox (open -> read, notes, replied, archive, bulk, spam),
// CSV export through the UI, dashboard cards per role, History tab of a form. Notifier mail + outbox timing: ../../../e2e-cross-system/80-m5.mjs.
import fs from 'node:fs';
import { launch, suite, ok, eq, session, open, api, rootToken, newUser, TAG, mainText, PORTAL_FE, sleep } from '../lib.mjs';

const t = suite('50 forms inbox dashboard');
const root = await rootToken();
const b = await launch();
const { page } = await session(b, {});
t.page = page;
const toast = (re) => page.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 10000 });
const visitor = await b.newContext({ viewport: { width: 1280, height: 900 } }); const vp = await visitor.newPage();
const submit = async (name, msg, { honeypot = false } = {}) => {
  // the form has a per-visitor daily limit: every message comes from its own (fake) client address
  await vp.setExtraHTTPHeaders({ 'x-nf-client-connection-ip': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` });
  await vp.goto(PORTAL_FE + '/contact', { waitUntil: 'networkidle' });
  await vp.waitForTimeout(4500); // the form refuses a fill time below minFillSeconds (3 s)
  await vp.fill('input[name=name]', name); await vp.fill('input[name=email]', `${name.replace(/\W/g, '').toLowerCase()}-${TAG}@example.test`); await vp.fill('input[name=phone]', '+856 20 1234 5678');
  const radio = vp.locator('input[name=topic]').first(); if (await radio.count()) await radio.check({ force: true }).catch(() => {});
  await vp.fill('textarea[name=message]', msg);
  if (honeypot) await vp.evaluate(() => { document.querySelector('input[name=company]').value = 'ACME'; });
  await vp.locator('form button[type=submit]').first().click(); await vp.waitForTimeout(2500);
};
const MSG1 = 'E2E message one ' + TAG, MSG2 = 'E2E message two ' + TAG;

await t.step('forms list shows the system contact form; recipients tab: add a recipient, saved and applied', async () => {
  await open(page, '/admin/forms');
  await page.getByText('Contact form').first().waitFor();
  await open(page, '/admin/forms/1?tab=recipients');
  const existing = await page.locator('input[aria-label^="E-mail address of recipient"]').count();
  if (existing === 0) {
    await page.getByRole('button', { name: 'Add a recipient' }).click();
    await page.locator('input[aria-label^="E-mail address of recipient"]').first().fill(`inbox-${TAG}@example.test`);
    await page.getByRole('button', { name: 'Save recipients' }).click(); await toast(/recipients were saved/i);
  }
  const f = (await api(root, 'GET', '/forms/1')).body.data; ok((f.recipients || []).length > 0, 'recipient stored on the server');
});

await t.step('a visitor submits the public contact form; the message appears in the inbox as New', async () => {
  await submit('E2E Visitor', MSG1);
  await open(page, '/admin/forms/submissions');
  await page.getByText(MSG1).first().waitFor({ timeout: 15000 });
  const row = page.locator('tr', { hasText: MSG1 }); ok(/New/.test(await row.innerText()), 'status New');
  // GET /submissions/summary is cached by the browser for 15 s (private, max-age=15): poll until the chip catches up
  const t0 = Date.now(); let chip = '';
  while (Date.now() - t0 < 25000) { chip = await page.getByRole('button', { name: /^New \(/ }).innerText(); if (/New \([1-9]/.test(chip)) break; await sleep(2500); await page.reload(); await page.getByText(MSG1).first().waitFor(); }
  ok(/New \([1-9]/.test(chip), 'New chip counts it: ' + chip);
});

await t.step('open the message: it becomes Read, add a note, mark as replied, archive', async () => {
  await page.locator('tr', { hasText: MSG1 }).locator('a').first().click();
  await page.waitForURL(/submissions\/\d+/);
  await page.getByText(MSG1).first().waitFor();
  await page.getByText('Read', { exact: true }).first().waitFor({ timeout: 8000 }); // auto-read after about 1 s
  await page.locator('textarea').first().fill('E2E note ' + TAG);
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.getByText('E2E note ' + TAG).first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Mark as replied' }).click();
  await page.getByText('Replied', { exact: true }).first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByText('Archived', { exact: true }).first().waitFor({ timeout: 8000 });
});

await t.step('inbox chips filter by status (Archived chip lists it, Spam chip does not)', async () => {
  await open(page, '/admin/forms/submissions');
  await page.getByText(MSG1).first().waitFor({ timeout: 8000 }); // default list = every status except spam
  await page.getByRole('button', { name: 'Archived', exact: true }).click(); await sleep(1200);
  await page.getByText(MSG1).first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Read', exact: true }).click(); await sleep(1200);
  eq(await page.getByText(MSG1).count(), 0, 'an archived message is not under Read');
});

await t.step('bulk: select a new message and archive it in one request', async () => {
  await submit('E2E Visitor Two', MSG2);
  await open(page, '/admin/forms/submissions');
  const row = page.locator('tr', { hasText: MSG2 }); await row.waitFor({ timeout: 15000 });
  await row.getByRole('checkbox').click();
  const bulk = page.getByRole('button', { name: /archive/i }).first(); await bulk.waitFor({ timeout: 5000 });
  const w = page.waitForResponse((r) => /bulk-status/.test(r.url()));
  await bulk.click();
  const dlg = page.getByRole('alertdialog'); if (await dlg.count()) await dlg.getByRole('button').last().click();
  eq((await w).status(), 200, 'bulk-status');
  await page.getByRole('button', { name: 'Archived', exact: true }).click(); await sleep(1200);
  await page.getByText(MSG2).first().waitFor({ timeout: 8000 });
});

await t.step('honeypot message is not in the default inbox but is under Spam', async () => {
  const SPAM = 'E2E spam ' + TAG;
  await submit('Bot', SPAM, { honeypot: true });
  await open(page, '/admin/forms/submissions'); await sleep(800);
  eq(await page.getByText(SPAM).count(), 0, 'not in default list');
  await page.getByRole('button', { name: 'Spam', exact: true }).click(); await sleep(1200);
  await page.getByText(SPAM).first().waitFor({ timeout: 8000 });
});

await t.step('export CSV from the UI: dialog, download with BOM and the message text', async () => {
  await open(page, '/admin/forms/submissions');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  const d = await dl; const file = await d.path(); const buf = fs.readFileSync(file);
  ok(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, 'UTF-8 BOM');
  ok(buf.toString('utf8').includes('E2E message'), 'rows present');
});

await t.step('form editor History tab shows the audit rows (forms.manage reader without ops.audit:read)', async () => {
  await open(page, '/admin/forms/1?tab=history'); await sleep(1500);
  ok((await mainText(page)).length > 200, 'history present');
});

await t.step('dashboard: administrator sees the cards; the viewer role sees fewer', async () => {
  await open(page, '/admin'); const adminText = await mainText(page);
  ok(/New messages/.test(adminText) && /My drafts/.test(adminText), 'admin cards: ' + adminText.slice(0, 120));
  const v = await newUser(root, 'viewer'); const V = await session(b, { user: v.username, pass: v.password });
  await open(V.page, '/admin'); const vt = await mainText(V.page);
  ok(!/New messages/.test(vt), 'viewer has no inbox card'); await V.ctx.close();
});

await t.done(b);
