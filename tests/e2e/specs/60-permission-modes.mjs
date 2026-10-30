// Permission modes against the real RBAC: read-only (viewer), translate-only (translator), editor without iam rights, default-deny of unknown routes.
import { launch, suite, ok, eq, session, open, api, rootToken, newUser, TAG, mainText } from '../lib.mjs';

const t = suite('60 permission modes');
const root = await rootToken();
const b = await launch();
const mk = async (role) => { const u = await newUser(root, role); return { u, ...(await session(b, { user: u.username, pass: u.password })) }; };
const V = await mk('viewer'), T = await mk('translator'), E = await mk('editor');
const navLabels = (p) => p.evaluate(() => [...document.querySelectorAll('[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"], a[data-slot^="sidebar-menu"]')].map((e) => e.innerText.trim()).filter(Boolean));
const noPermission = /no permission|not allowed|do not have|forbidden|access/i;

await t.step('viewer: sidebar has no Access control entries; /admin/users shows the no-permission state, not data', async () => {
  const nav = await navLabels(V.page); ok(!nav.some((n) => /^Users$|^Roles$/.test(n)), 'no Users/Roles in nav: ' + nav.join(','));
  await open(V.page, '/admin/users');
  const txt = await mainText(V.page); ok(noPermission.test(txt) || /not found/i.test(txt), 'guard text: ' + txt.slice(0, 120));
  eq(await V.page.getByRole('button', { name: 'Add user' }).count(), 0, 'no Add user');
});

await t.step('viewer: site settings are read-only (inputs disabled, Save disabled or absent)', async () => {
  await open(V.page, '/admin/settings/contact');
  const inputs = V.page.locator('main input:not([type=hidden]), main textarea'); const n = await inputs.count(); ok(n > 0, 'fields shown');
  for (let i = 0; i < n; i++) ok(await inputs.nth(i).isDisabled(), 'input ' + i + ' disabled');
  const save = V.page.getByRole('button', { name: /^Save$/ }); ok((await save.count()) === 0 || (await save.isDisabled()), 'Save disabled');
});

await t.step('viewer: pages list has no New page button; page editor has no publish controls', async () => {
  await open(V.page, '/admin/pages'); await V.page.getByRole('heading', { name: 'Pages' }).first().waitFor();
  eq(await V.page.getByRole('button', { name: /new page/i }).count(), 0, 'no New page');
  await open(V.page, '/admin/pages/1');
  eq(await V.page.getByRole('button', { name: /^Publish/ }).count(), 0, 'no Publish');
  eq(await V.page.getByRole('button', { name: /^Unpublish/ }).count(), 0, 'no Unpublish');
});

await t.step('viewer: the API refuses a write with 403 (not 5xx) even if the UI were bypassed', async () => {
  const r = await api(V.u.token, 'POST', '/pages/1/publish', {}, { 'if-match': '"1"' }); ok(r.status === 403, 'publish as viewer ' + r.status);
  const s = await api(V.u.token, 'GET', '/users'); ok(s.status === 403, 'GET /users as viewer ' + s.status);
});

await t.step('translator: non-text settings fields are disabled, a text field can be edited and saved', async () => {
  await open(T.page, '/admin/settings/contact');
  const fields = T.page.locator('main input:not([type=hidden]), main textarea'); const n = await fields.count();
  let enabled = null, disabledCount = 0;
  for (let i = 0; i < n; i++) { if (await fields.nth(i).isDisabled()) disabledCount++; else if (!enabled) enabled = fields.nth(i); }
  ok(disabledCount > 0, 'some fields are disabled for a translator'); ok(enabled, 'a text field is enabled');
  const cur = await enabled.inputValue(); await enabled.fill(cur + ' t' + TAG.slice(-3));
  const w = T.page.waitForResponse((r) => ['PUT', 'PATCH'].includes(r.request().method()) && /settings/.test(r.url()));
  await T.page.getByRole('button', { name: /^Save$/ }).click(); eq((await w).status(), 200, 'translator save');
});

await t.step('translator: no "New page" / "New post" controls', async () => {
  await open(T.page, '/admin/pages'); eq(await T.page.getByRole('button', { name: /new page/i }).count(), 0, 'no New page');
  await open(T.page, '/admin/blog/posts'); eq(await T.page.getByRole('button', { name: /new post/i }).count(), 0, 'no New post');
});

await t.step('editor: no Access control / Operations entries; /admin/roles is not served', async () => {
  const nav = await navLabels(E.page); ok(!nav.some((n) => /^Roles$|^Users$|Audit/.test(n)), 'nav: ' + nav.join(','));
  await open(E.page, '/admin/roles'); const txt = await mainText(E.page);
  ok(noPermission.test(txt) || /not found/i.test(txt), 'guard text: ' + txt.slice(0, 120));
  eq(await E.page.getByRole('button', { name: 'Create role' }).count(), 0, 'no Create role');
});

await t.step('an unknown /admin route answers a not-found page, and 403 reads never sign the user out', async () => {
  await open(E.page, '/admin/does-not-exist'); await E.page.getByText(/page not found|could not be found|404/i).first().waitFor({ timeout: 8000 });
  const r = await api(E.u.token, 'GET', '/roles'); ok(r.status === 403 || r.status === 200, 'editor roles read ' + r.status);
  await open(E.page, '/admin/pages'); ok(new URL(E.page.url()).pathname === '/admin/pages', 'still signed in after 403s');
});

await t.step('no page errors in any role session', async () => {
  for (const S of [V, T, E]) { const pe = S.sink.console.filter((c) => c.startsWith('PAGEERROR')); ok(pe.length === 0, pe.join(' | ')); }
});
await t.done(b);
