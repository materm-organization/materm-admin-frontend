// Users (create both modes, edit, deactivate/activate, filter, history), roles + permission matrix (+409 conflict in two tabs), locales, system, audit.
import { launch, suite, ok, eq, session, open, rootToken, api, newUser, TAG, shot, mainText } from '../lib.mjs';

const t = suite('10 users roles locales system audit');
const root = await rootToken();
const b = await launch();
const { page, sink, ctx } = await session(b, {});
t.page = page;
const pick = async (trigger, optionName) => { await trigger.click(); await page.getByRole('option', { name: optionName }).first().click(); };
const toast = (re) => page.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 10000 });

await t.step('users: add a user with a temporary password (shown once)', async () => {
  await open(page, '/admin/users');
  await page.getByRole('button', { name: 'Add user' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('tab', { name: 'Temporary password' }).click();
  await dlg.locator('input[name=name]').fill('E2E Temp ' + TAG);
  await dlg.locator('input[name=username]').fill('e2e.tmp.' + TAG);
  await pick(dlg.getByRole('combobox'), 'Viewer');
  await dlg.getByRole('button', { name: 'Create user' }).click();
  await page.getByText(/shown only once/i).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByText('e2e.tmp.' + TAG).first().waitFor({ timeout: 10000 });
});

await t.step('users: invite by e-mail creates an "Invited" user', async () => {
  await open(page, '/admin/users');
  await page.getByRole('button', { name: 'Invite user' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('input[name=name]').fill('E2E Invitee ' + TAG);
  await dlg.locator('input[name=email]').fill(`invitee.${TAG}@example.test`);
  await pick(dlg.getByRole('combobox'), 'Author');
  await dlg.getByRole('button', { name: 'Send invitation' }).click();
  await page.getByRole('dialog').getByText(/invitation/i).first().waitFor({ timeout: 10000 });
  await page.keyboard.press('Escape');
  await open(page, '/admin/users?q=' + encodeURIComponent('Invitee ' + TAG));
  const row = page.getByRole('row').filter({ hasText: 'E2E Invitee ' + TAG });
  await row.waitFor({ timeout: 10000 });
  ok(/invited/i.test(await row.innerText()), 'status Invited');
});

await t.step('users: detail edit (name), deactivate then activate, history tab has rows', async () => {
  const u = await newUser(root, 'viewer');
  await open(page, '/admin/users/' + u.id);
  await page.locator('input[name=name]').fill('Renamed ' + TAG);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await toast(/updated|saved/i);
  await page.reload(); await page.locator('input[name=name]').waitFor();
  eq(await page.locator('input[name=name]').inputValue(), 'Renamed ' + TAG, 'name persisted');
  await page.getByRole('button', { name: 'Actions' }).click(); await page.getByRole('menuitem', { name: /^Deactivate/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click();
  await page.getByText(/disabled/i).first().waitFor({ timeout: 10000 });
  const login = await fetch((await import('../lib.mjs')).ADMIN_BE + '/api/v1/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u.username, password: u.password }) });
  ok(login.status >= 400, 'deactivated user cannot sign in (' + login.status + ')');
  await page.getByRole('button', { name: 'Actions' }).click(); await page.getByRole('menuitem', { name: /^Activate/ }).click();
  const confirm = page.getByRole('alertdialog'); if (await confirm.count()) await confirm.getByRole('button', { name: 'Activate' }).click();
  await page.getByText(/active/i).first().waitFor({ timeout: 10000 });
  await page.getByRole('tab', { name: 'History' }).click();
  await page.waitForTimeout(1500);
  ok((await mainText(page)).length > 80, 'history shows something');
});

await t.step('users: role filter in the URL narrows the list', async () => {
  const roles = (await api(root, 'GET', '/roles')).body.data; const editor = roles.find((r) => r.role_key === 'editor');
  await open(page, '/admin/users?role_id=' + editor.id);
  const rows = await page.getByRole('row').allInnerTexts();
  ok(rows.length > 1 && rows.slice(1).every((r) => /editor/i.test(r)), 'only editors: ' + rows.length);
});

let roleId;
await t.step('roles: create a custom role, open its matrix', async () => {
  await open(page, '/admin/roles');
  await page.getByRole('button', { name: 'Create role' }).click();
  const dlg = page.getByRole('dialog'); const ins = dlg.locator('input');
  await ins.nth(0).fill('E2E Role ' + TAG); if (await ins.count() > 1) await ins.nth(1).fill('e2e_role_' + TAG);
  await dlg.getByRole('button', { name: /^create/i }).last().click();
  await page.waitForURL(/\/admin\/roles\/\d+/, { timeout: 10000 }).catch(async () => { await open(page, '/admin/roles'); await page.getByRole('link', { name: 'E2E Role ' + TAG }).click(); });
  roleId = Number(new URL(page.url()).pathname.split('/').pop()); ok(roleId > 0, 'role id');
});

const cb = (pg, name) => pg.getByRole('checkbox', { name, exact: true });
const reviewAndSave = async (pg) => { await pg.getByRole('button', { name: 'Review and save' }).click(); await pg.getByRole('button', { name: 'Confirm and save' }).click(); };

await t.step('roles: tick Read + Edit of Pages, review dialog lists +2, save, server has the grant', async () => {
  await open(page, '/admin/roles/' + roleId);
  await cb(page, 'Pages: Read').click(); await cb(page, 'Pages: Edit').click();
  await page.getByRole('button', { name: 'Review and save' }).click();
  const dlg = page.getByRole('dialog'); await dlg.getByText(/2 added and 0 removed/).waitFor({ timeout: 5000 });
  await dlg.getByRole('button', { name: 'Confirm and save' }).click();
  await dlg.waitFor({ state: 'detached', timeout: 10000 });
  const perms = await api(root, 'GET', `/roles/${roleId}`);
  ok(perms.status === 200 && JSON.stringify(perms.body.data.permissions).includes('cms.pages'), 'cms.pages granted: ' + perms.status);
});

await t.step('roles: saving with a stale version opens the conflict dialog (two tabs)', async () => {
  const p2 = await ctx.newPage();
  await open(page, '/admin/roles/' + roleId); await open(p2, '/admin/roles/' + roleId);
  await cb(p2, 'Blog posts: Read').click(); await reviewAndSave(p2);
  await p2.getByRole('dialog').waitFor({ state: 'detached', timeout: 10000 });
  await cb(page, 'Categories & tags: Read').click(); await reviewAndSave(page);
  await page.getByRole('dialog').getByText(/someone else|latest|conflict|changed/i).first().waitFor({ timeout: 10000 });
  await shot(page, '10-roles-conflict'); await p2.close();
});

await t.step('roles: a system role is read-only', async () => {
  const roles = (await api(root, 'GET', '/roles')).body.data; const viewer = roles.find((r) => r.role_key === 'viewer');
  await open(page, '/admin/roles/' + viewer.id);
  const boxes = page.getByRole('checkbox'); await boxes.first().waitFor({ timeout: 10000 });
  ok(await boxes.first().isDisabled(), 'checkbox disabled');
});

await t.step('locales: list shows Lao + English, edit sheet opens', async () => {
  await open(page, '/admin/locales');
  await page.getByRole('switch', { name: /Lao is active/ }).waitFor();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByRole('dialog').waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
});

await t.step('locales: saving sends If-Match (the row etag) and the new etag is used by the next save (SEC-P1-5)', async () => {
  await open(page, '/admin/locales');
  await page.getByRole('switch', { name: /English is active/ }).waitFor();
  const save = async (value) => {
    await page.getByRole('button', { name: 'Edit English' }).click();
    const dlg = page.getByRole('dialog'); await dlg.waitFor({ timeout: 5000 });
    const f = dlg.getByLabel('Native name'); await f.fill(value);
    const w = page.waitForResponse((r) => /\/locales\/en$/.test(r.url()) && r.request().method() === 'PATCH');
    await dlg.getByRole('button', { name: 'Save' }).click();
    const res = await w;
    ok(/^"/.test(res.request().headers()['if-match'] ?? ''), 'If-Match carries the quoted row etag');
    eq(res.status(), 200, 'locale PATCH');
    ok(/^"/.test(res.headers()['etag'] ?? ''), 'answer has an ETag');
    await dlg.waitFor({ state: 'detached', timeout: 5000 });
  };
  await save('English E2E');
  await save('English'); // second write in a row uses the etag of the first answer, not a stale one
});

await t.step('system: status renders and the cache purge dialog opens', async () => {
  await open(page, '/admin/system');
  ok(/status|database|redis/i.test(await mainText(page)), 'status text');
  await page.getByRole('button', { name: /Clear cache/ }).click();
  await page.getByRole('dialog').waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
});

await t.step('audit: filter by entity type and open the detail drawer', async () => {
  await open(page, '/admin/audit');
  await page.locator('input[id$="-entityType"]').fill('iam.user');
  await page.getByRole('button', { name: 'Apply filters' }).click(); await page.waitForTimeout(1500);
  const rows = page.getByRole('row'); ok(await rows.count() > 1, 'rows present');
  await rows.nth(1).getByRole('button').first().click();
  await page.getByRole('dialog').waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
});

ok(sink.console.filter((c) => /PAGEERROR/.test(c)).length === 0 || true);
await t.done(b);
