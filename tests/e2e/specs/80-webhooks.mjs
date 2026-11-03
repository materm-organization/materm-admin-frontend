// External webhooks (SCR-43) against the real backend. super_admin only: create refusals (http, private / metadata / loopback address, localhost, port,
// credentials), create with a PUBLIC IP literal (the early URL check needs no DNS), the one-time secret (shown once, not in the page, storage or the API
// afterwards), edit with If-Match from `etag` (+ a 409 in two views, a refusal on edit), rotate, list filters, the deliveries drawer (empty), the Test
// dialog (opened, NOT run), History, delete, and admin / viewer getting no access.
// NO real delivery is ever made: every webhook this spec creates is SWITCHED OFF (the worker fans out to active webhooks only) and the Test button is
// never pressed (it would dial the address). The harness gives the backend a throw-away `security.webhookSecretKey` (e2e-cross-system/02-backends.sh).
import { launch, suite, ok, eq, session, open, api, rootToken, newUser, TAG, shot, mainText } from '../lib.mjs';

const t = suite('80 webhooks');
const root = await rootToken();
const b = await launch();
const S = await session(b, {});
const adminU = await newUser(root, 'admin');
const viewerU = await newUser(root, 'viewer');
const AD = await session(b, { user: adminU.username, pass: adminU.password });
const VW = await session(b, { user: viewerU.username, pass: viewerU.password });
t.page = S.page;
const page = S.page;
const toast = (pg, re) => pg.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 10000 });
const NAME = `E2E hook ${TAG}`;
const URL1 = `https://93.184.216.34/e2e-${TAG}`;
const SECRET_RE = /^whsec_[A-Za-z0-9_-]{43}$/;
const navLabels = (p) => p.evaluate(() => [...document.querySelectorAll('[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"], a[data-slot^="sidebar-menu"]')].map((e) => e.innerText.trim()).filter(Boolean));
const list = async () => (await api(root, 'GET', '/webhooks?limit=100')).body.data;
const byName = async (name) => (await list()).find((w) => w.name === name);
const sentTests = []; page.on('request', (r) => { if (/\/webhooks\/\d+\/test$/.test(r.url())) sentTests.push(r.url()); });
const dialogOf = () => page.getByRole('dialog').last();
let id; let secret1; let hint1; let etag0;
const before = (await list()).length;

await t.step('super_admin: Webhooks is an entry of the Operations group and the list opens (empty state when nothing exists)', async () => {
  await open(page, '/admin');
  await page.getByRole('button', { name: 'Operations' }).click();
  await page.getByRole('link', { name: 'Webhooks' }).waitFor({ timeout: 5000 });
  await page.getByRole('link', { name: 'Webhooks' }).click();
  await page.waitForURL(/\/admin\/webhooks/);
  await page.getByRole('heading', { name: 'Webhooks' }).first().waitFor();
  await page.getByRole('button', { name: 'New webhook' }).waitFor();
  await shot(page, '80-list-empty');
});

const refusal = async (url, message, eventLabel = /^File ready/) => {
  await page.getByRole('button', { name: 'New webhook' }).click();
  const d = dialogOf();
  await d.getByLabel(/^Name/).fill('E2E refuse ' + TAG);
  await d.getByLabel(/^Address/).fill(url);
  await d.getByRole('checkbox', { name: eventLabel }).click();
  const w = page.waitForResponse((r) => r.url().includes('/webhooks') && r.request().method() === 'POST');
  await d.getByRole('button', { name: 'Create webhook' }).click();
  const res = await w; eq(res.status(), 422, 'status for ' + url);
  const body = await res.json(); ok(body.code === 'VALIDATION_FAILED', 'code');
  await d.getByText(message).waitFor({ timeout: 8000 });
  const txt = await d.innerText(); ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(txt.replace(url, '').replace(/93\.184\.216\.34/g, '')), 'no resolved address in the dialog text');
  return { d, body };
};
const closeDialog = async () => { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' }); };

await t.step('create refusals: http, private IP, cloud metadata IP, loopback v6, localhost, port, credentials are explained at the address field and create nothing', async () => {
  const cases = [
    ['http://93.184.216.34/a', 'Only addresses that start with https:// are allowed.', 'scheme_not_allowed'],
    ['https://10.0.0.5/a', 'This address points to a private or internal network and cannot be used.', 'address_not_allowed'],
    ['https://169.254.169.254/latest', 'This address points to a private or internal network and cannot be used.', 'address_not_allowed'],
    ['https://[::1]/a', 'This address points to a private or internal network and cannot be used.', 'address_not_allowed'],
    ['https://localhost/a', 'This name cannot be used (for example localhost or an internal name).', 'host_not_allowed'],
    ['https://93.184.216.34:8443/a', /This port is not allowed\. Allowed: 443\./, 'port_not_allowed'],
    ['https://user:pw@93.184.216.34/a', 'The address must not contain a user name or password.', 'credentials_not_allowed'],
  ];
  for (const [url, message, code] of cases) {
    const { body } = await refusal(url, message);
    ok(body.errors.some((e) => e.path === '/url' && e.code === code), `${url}: server code ${code}, got ${JSON.stringify(body.errors)}`);
    if (url.includes('8443')) await shot(page, '80-create-field-error');
    // keep the dialog open for the next case? close it so each case starts clean
    await closeDialog();
  }
  eq((await list()).length, before, 'nothing was created');
});

await t.step('create refusal: the missing fields are caught before any request; an unknown event cannot be sent from the UI', async () => {
  await page.getByRole('button', { name: 'New webhook' }).click();
  const d = dialogOf();
  let posts = 0; const on = (r) => { if (r.method() === 'POST' && /\/webhooks$/.test(r.url())) posts++; }; page.on('request', on);
  await d.getByRole('button', { name: 'Create webhook' }).click();
  await d.getByText('Enter a name.').waitFor();
  await d.getByText('Enter the address.').waitFor();
  await d.getByText('Choose at least one event.').waitFor();
  await d.getByLabel(/^Time to wait/).fill('50');
  await d.getByLabel(/^Name/).fill('x'); await d.getByLabel(/^Address/).fill('https://93.184.216.34/a'); await d.getByRole('checkbox', { name: /^File ready/ }).click();
  await d.getByRole('button', { name: 'Create webhook' }).click();
  await d.getByText('Enter a number from 1000 to 10000.').waitFor();
  page.off('request', on); eq(posts, 0, 'no POST was sent');
  await closeDialog();
});

await t.step('create with a public https IP literal (switched off): the secret is shown ONCE in its own dialog, Esc does not dismiss it, Done clears it', async () => {
  await page.getByRole('button', { name: 'New webhook' }).click();
  const d = dialogOf();
  await d.getByLabel(/^Name/).fill(NAME);
  await d.getByLabel(/^Address/).fill(URL1);
  await d.getByRole('checkbox', { name: /^File ready/ }).click();
  await d.getByRole('switch', { name: 'Active' }).click(); // switched OFF: nothing is ever delivered
  const w = page.waitForResponse((r) => r.url().endsWith('/webhooks') && r.request().method() === 'POST');
  await d.getByRole('button', { name: 'Create webhook' }).click();
  const res = await w; eq(res.status(), 201, 'create status');
  ok(res.headers()['idempotent-replayed'] !== 'true', 'not a replay');
  const sd = page.getByRole('dialog', { name: /Webhook secret/ }); await sd.waitFor();
  secret1 = await sd.getByLabel('Signing secret').inputValue();
  ok(SECRET_RE.test(secret1), 'secret shape whsec_ + 43');
  hint1 = secret1.slice(-4);
  await sd.getByText(/shown only once/).waitFor();
  await shot(page, '80-secret-once');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  eq(await sd.isVisible(), true, 'Esc does not dismiss the secret dialog');
  await sd.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const html = await page.content(); ok(!html.includes(secret1), 'secret is not in the page after Done');
  const stores = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])); ok(!stores.includes(secret1), 'secret is not in web storage');
  const row = await byName(NAME); ok(row, 'created'); id = row.id; etag0 = row.etag;
  eq(row.is_active, false, 'switched off'); eq(row.secret_hint, hint1, 'secret_hint = last 4 of the shown secret');
  const got = await api(root, 'GET', '/webhooks/' + id); ok(!JSON.stringify(got.body).includes(secret1) && !('secret' in got.body.data), 'GET has no secret');
  eq(got.etag, got.body.data.etag, 'ETag header = etag field'); ok(!got.body.data.etag.includes(got.body.data.updated_at), 'etag is not updated_at');
  await page.getByText(NAME).first().waitFor();
});

await t.step('list: keyword, is_active and event filters (URL state) and the status badge / failures / last success columns', async () => {
  await open(page, `/admin/webhooks?keyword=${TAG}&is_active=false&event=media.ready`);
  const row = page.getByRole('row').filter({ hasText: NAME }); await row.waitFor();
  const txt = await row.innerText(); ok(/Switched off/.test(txt) && /File ready/.test(txt) && txt.includes(URL1), 'row content: ' + txt.replace(/\s+/g, ' '));
  ok(/Never/.test(txt), 'last success: Never');
  await open(page, `/admin/webhooks?keyword=${TAG}&event=user.created`);
  eq(await page.getByText(NAME).count(), 0, 'event filter hides it');
  await open(page, `/admin/webhooks?keyword=${TAG}&is_active=true`);
  eq(await page.getByText(NAME).count(), 0, 'status filter hides it');
  await open(page, '/admin/webhooks');
  await page.getByText(NAME).first().waitFor();
  await shot(page, '80-list');
});

await t.step('edit: the dialog loads the row, shows only the last 4 of the secret, saves a change with If-Match = the etag it was given, and the etag moves', async () => {
  const get = page.waitForResponse((r) => r.url().endsWith('/webhooks/' + id) && r.request().method() === 'GET');
  await page.getByRole('button', { name: 'Edit ' + NAME }).click();
  const g = await get; const gEtag = g.headers()['etag'];
  const d = dialogOf(); await d.getByLabel(/^Name/).waitFor();
  eq(await d.getByTestId('webhook-secret-hint').innerText(), '••••' + hint1, 'hint shown');
  ok(!(await d.innerText()).includes(secret1), 'no secret in the dialog');
  await d.getByLabel(/^Name/).fill(NAME + ' v2');
  await d.getByLabel(/^Time to wait/).fill('7000');
  const pr = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/webhooks/' + id));
  const pw = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith('/webhooks/' + id));
  await d.getByRole('button', { name: 'Save' }).click();
  const req = await pr; eq(req.headers()['if-match'], gEtag, 'If-Match is the etag the GET returned');
  const res = await pw; eq(res.status(), 200, 'patch status'); ok(res.headers()['etag'] && res.headers()['etag'] !== gEtag, 'new etag');
  await toast(page, /Saved\./);
  const row = await byName(NAME + ' v2'); ok(row && row.timeout_ms === 7000, 'saved'); ok(row.etag !== etag0, 'list etag moved');
  await shot(page, '80-edit');
});

await t.step('edit: a refusal on the address field (http) is shown at the field; nothing changes', async () => {
  const d = dialogOf();
  await d.getByLabel(/^Address/).fill('http://93.184.216.34/x');
  await d.getByRole('button', { name: 'Save' }).click();
  await d.getByText('Only addresses that start with https:// are allowed.').waitFor();
  eq((await api(root, 'GET', '/webhooks/' + id)).body.data.url, URL1, 'url unchanged');
  await d.getByLabel(/^Address/).fill(URL1);
});

await t.step('edit: a change from another view meanwhile opens the conflict dialog (409) and the other view wins', async () => {
  const d = dialogOf();
  const cur = (await api(root, 'GET', '/webhooks/' + id));
  const other = await api(root, 'PATCH', '/webhooks/' + id, { name: NAME + ' v3' }, { 'if-match': cur.etag }); eq(other.status, 200, 'other view saves');
  await d.getByLabel(/^Name/).fill(NAME + ' mine');
  await d.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Someone else changed this item').waitFor({ timeout: 8000 });
  eq((await api(root, 'GET', '/webhooks/' + id)).body.data.name, NAME + ' v3', 'server keeps the other change');
  await page.getByRole('button', { name: 'Load the latest version (discard my changes)' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
});

await t.step('rotate: confirm -> a NEW secret is shown once; the hint changes; the old secret is not shown again anywhere', async () => {
  await open(page, `/admin/webhooks?keyword=${TAG}`);
  await page.getByRole('button', { name: /^Rotate the secret of / }).click();
  const c = page.getByRole('alertdialog'); await c.getByText(/old secret stops working at once/).waitFor();
  const pr = page.waitForRequest((r) => r.url().endsWith(`/webhooks/${id}/rotate-secret`));
  await c.getByRole('button', { name: 'Rotate secret' }).click();
  const req = await pr; ok(req.headers()['if-match'], 'If-Match sent');
  const sd = page.getByRole('dialog', { name: /New webhook secret/ }); await sd.waitFor();
  const secret2 = await sd.getByLabel('Signing secret').inputValue(); ok(SECRET_RE.test(secret2) && secret2 !== secret1, 'a different secret');
  await shot(page, '80-secret-rotated');
  await sd.getByRole('button', { name: 'Done' }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' });
  const html = await page.content(); ok(!html.includes(secret2) && !html.includes(secret1), 'neither secret is in the page');
  const row = await byName(NAME + ' v3'); eq(row.secret_hint, secret2.slice(-4), 'hint of the new secret');
  ok(!JSON.stringify(await list()).includes(secret2), 'list has no secret');
});

await t.step('test dialog: opens with the address and the explanation, sends NOTHING until pressed (and is not pressed here: it would dial the address)', async () => {
  await page.getByRole('button', { name: /^Send a test to / }).click();
  const d = page.getByTestId('webhook-test-dialog'); await d.waitFor();
  eq((await d.getByTestId('webhook-test-url').innerText()).trim(), URL1, 'address shown');
  await d.getByText(/This webhook is switched off\. You can still test it\./).waitFor();
  await page.waitForTimeout(800);
  eq(sentTests.length, 0, 'no /test request');
  await shot(page, '80-test-dialog');
  await closeDialog();
});

await t.step('deliveries drawer: empty for a new webhook; the status filter is sent as a query; the filtered empty state differs', async () => {
  await page.getByRole('button', { name: /^Deliveries of / }).click();
  const sheet = page.getByTestId('webhook-deliveries'); await sheet.waitFor();
  await sheet.getByText('Nothing has been sent yet.').waitFor();
  await sheet.getByRole('button', { name: /Status/ }).click();
  await page.getByRole('option', { name: /Gave up/ }).click();
  const w = page.waitForResponse((r) => r.url().includes(`/webhooks/${id}/deliveries`) && r.url().includes('status=dead'));
  await page.getByRole('button', { name: 'Search' }).click();
  eq((await w).status(), 200, 'filtered list status');
  await sheet.getByText('No deliveries match these filters.').waitFor();
  await shot(page, '80-deliveries-empty');
  await sheet.getByRole('button', { name: 'Close' }).click(); await page.getByTestId('webhook-deliveries').waitFor({ state: 'detached' });
});

await t.step('History tab: created, changed and secret rotated, with the actor, and no secret anywhere in it', async () => {
  await page.getByRole('button', { name: /^Edit / }).first().click();
  const d = dialogOf(); await d.getByRole('tab', { name: 'History' }).click();
  const hist = d.getByTestId('webhook-activity'); await hist.waitFor();
  const txt = await hist.innerText();
  for (const label of ['Created', 'Changed', 'Secret rotated']) ok(txt.includes(label), 'History has ' + label + ': ' + txt.replace(/\s+/g, ' '));
  ok(!txt.includes('whsec_'), 'no secret in History');
  await shot(page, '80-history');
  await closeDialog();
});

await t.step('delete: confirm, DELETE with If-Match, gone from the list and from the API (404); no trash', async () => {
  await open(page, `/admin/webhooks?keyword=${TAG}`);
  await page.getByRole('button', { name: /^Delete / }).click();
  const c = page.getByRole('alertdialog'); await c.getByText(/There is no trash/).waitFor();
  const pr = page.waitForRequest((r) => r.method() === 'DELETE' && r.url().endsWith('/webhooks/' + id));
  await c.getByRole('button', { name: 'Delete webhook' }).click();
  ok((await pr).headers()['if-match'], 'If-Match sent');
  await toast(page, /Webhook deleted\./);
  eq((await api(root, 'GET', '/webhooks/' + id)).status, 404, 'GET after delete');
  eq((await list()).length, before, 'back to the starting count');
});

for (const [who, X, U] of [['admin', AD, adminU], ['viewer', VW, viewerU]]) {
  await t.step(`${who}: no Webhooks in the sidebar, the page shows the no-permission state, and the API answers 403 to read, create and deliveries`, async () => {
    const nav = await navLabels(X.page); ok(!nav.includes('Webhooks'), 'no Webhooks in nav: ' + nav.join(','));
    await open(X.page, '/admin/webhooks');
    const txt = await mainText(X.page); ok(/no permission|not allowed|do not have|forbidden|access/i.test(txt), 'guard text: ' + txt.slice(0, 120));
    eq(await X.page.getByRole('button', { name: 'New webhook' }).count(), 0, 'no New webhook button');
    eq((await api(U.token, 'GET', '/webhooks')).status, 403, 'GET /webhooks');
    eq((await api(U.token, 'POST', '/webhooks', { name: 'x', url: URL1, events: ['media.ready'] })).status, 403, 'POST /webhooks');
    eq((await api(U.token, 'GET', '/webhooks/1/deliveries')).status, 403, 'deliveries');
    eq((await api(U.token, 'POST', '/webhooks/1/test')).status, 403, 'test');
  });
}

// leave nothing behind
for (const w of (await list()).filter((w) => w.name.includes(TAG))) await api(root, 'DELETE', '/webhooks/' + w.id, undefined, { 'if-match': w.etag });
await t.done(S.ctx, AD.ctx, VW.ctx, b);
