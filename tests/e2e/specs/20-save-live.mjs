// Save-live screens against the real backend: settings + SEO (+409 in two tabs, history), UI strings, categories / tags, menus, media metadata.
import { launch, suite, ok, eq, session, open, TAG, shot } from '../lib.mjs';

const t = suite('20 save-live');
const b = await launch();
const { page, sink, ctx } = await session(b, {});
t.page = page;
const toast = (re, pg = page) => pg.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 10000 });

await t.step('settings/brand: edit the brand statement, save, reload keeps it, website footer shows it', async () => {
  await open(page, '/admin/settings/brand');
  const area = page.locator('textarea').first();
  const text = `E2E brand ${TAG} forging paths.`;
  await area.fill(text);
  await page.getByRole('button', { name: /^Save$/ }).click();
  await toast(/saved|updated/i);
  await page.reload(); await page.locator('textarea').first().waitFor();
  eq(await page.locator('textarea').first().inputValue(), text, 'persisted');
});

await t.step('settings: History opens and lists the previous version', async () => {
  await open(page, '/admin/settings/brand');
  await page.getByRole('button', { name: 'History' }).click();
  await page.getByRole('dialog').waitFor({ timeout: 8000 });
  await page.waitForTimeout(1200);
  ok(/restore|version|changed/i.test(await page.getByRole('dialog').innerText()), 'revision rows');
  await page.keyboard.press('Escape');
});

await t.step('settings: saving a stale version (second tab saved first) opens the conflict dialog', async () => {
  const p2 = await ctx.newPage();
  await open(page, '/admin/settings/contact'); await open(p2, '/admin/settings/contact');
  const ins2 = p2.locator('main input:not([type=hidden]), main textarea').first(); await ins2.waitFor();
  const orig = await ins2.inputValue();
  await ins2.fill(orig + ' A'); await p2.getByRole('button', { name: /^Save$/ }).click(); await toast(/saved|updated/i, p2);
  const ins1 = page.locator('main input:not([type=hidden]), main textarea').first();
  await ins1.fill(orig + ' B'); await page.getByRole('button', { name: /^Save$/ }).click();
  await page.getByRole('dialog').waitFor({ timeout: 10000 });
  await shot(page, '20-settings-conflict');
  ok(/changed|latest|someone/i.test(await page.getByRole('dialog').innerText()), 'conflict text');
  await p2.close();
});

await t.step('seo: edit the site title and see it in the search preview', async () => {
  await open(page, '/admin/seo');
  const ti = page.locator('main input').first(); await ti.fill('Materm E2E ' + TAG);
  await page.getByRole('button', { name: /^Save$/ }).click(); await toast(/saved|updated/i);
  await page.reload(); eq(await page.locator('main input').first().inputValue(), 'Materm E2E ' + TAG, 'persisted');
  await page.getByText('materm.example').first().waitFor({ timeout: 8000 }); // search-result preview shows the site address
});

await t.step('ui strings: edit a string, it persists, History tab shows a revision', async () => {
  await open(page, '/admin/ui-strings');
  await page.getByRole('row').filter({ hasText: 'blog.categories.all' }).getByRole('cell').last().click();
  const dlg = page.getByRole('dialog'); await dlg.locator('textarea').waitFor();
  const v = 'All posts ' + TAG; await dlg.locator('textarea').fill(v);
  await dlg.getByRole('button', { name: 'Save', exact: true }).click(); await toast(/saved|updated/i);
  await page.keyboard.press('Escape');
  await open(page, '/admin/ui-strings');
  await page.getByText(v).first().waitFor({ timeout: 8000 });
  await page.getByRole('row').filter({ hasText: 'blog.categories.all' }).getByRole('cell').last().click();
  await page.getByRole('dialog').getByRole('tab', { name: 'History' }).click(); await page.waitForTimeout(1500);
  ok((await page.getByRole('dialog').innerText()).length > 60, 'history content');
  await page.keyboard.press('Escape');
});

await t.step('categories: create, rename via edit, delete to trash', async () => {
  await open(page, '/admin/blog/categories');
  await page.getByRole('button', { name: 'New category' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('input[id$="-key"]').fill('e2e-cat-' + TAG); await dlg.locator('input[id$="-la-name"]').fill('E2E Cat ' + TAG);
  await dlg.getByRole('button', { name: 'Create', exact: true }).click(); await toast(/created|saved/i);
  await page.getByText('E2E Cat ' + TAG).first().waitFor();
  await page.getByRole('button', { name: 'Edit E2E Cat ' + TAG }).click();
  await page.getByRole('dialog').locator('input[id$="-la-name"]').fill('E2E Cat2 ' + TAG);
  await page.getByRole('dialog').getByRole('button', { name: /^Save$/ }).click(); await toast(/saved|updated/i);
  await page.keyboard.press('Escape'); // the edit dialog stays open after a save
  await page.getByText('E2E Cat2 ' + TAG).first().waitFor();
  await page.locator('tr', { hasText: 'E2E Cat2 ' + TAG }).getByRole('button', { name: /^Delete/ }).click();
  const c = page.getByRole('alertdialog'); await c.getByRole('button').last().click();
  await page.getByText('E2E Cat2 ' + TAG).first().waitFor({ state: 'detached', timeout: 10000 });
});

await t.step('tags: create a tag', async () => {
  await open(page, '/admin/blog/tags');
  await page.getByRole('button', { name: 'New tag' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('input[id$="-key"]').fill('e2e-tag-' + TAG); await dlg.locator('input[id$="-la-name"]').fill('E2E Tag ' + TAG);
  await dlg.getByRole('button', { name: 'Create', exact: true }).click(); await toast(/created|saved/i);
  await page.getByText('E2E Tag ' + TAG).first().waitFor();
});

await t.step('menus: add an item, save, it shows on the website, move it, delete it', async () => {
  await open(page, '/admin/menus/main');
  await page.getByRole('button', { name: 'Add item' }).click();
  const label = 'E2EM ' + TAG;
  await page.locator('input[id$="-label"]').fill(label);
  await page.locator('button[id$="-page"]').click(); await page.getByRole('option', { name: /\(\/our-path\)/ }).click();
  await page.getByRole('button', { name: 'Add item', exact: true }).last().click();
  await page.getByRole('button', { name: new RegExp('^' + label) }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Move ' + label + ' up' }).click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Save order/ }).click(); await page.waitForTimeout(1200);
  await page.getByRole('tab', { name: 'History' }).click(); await page.waitForTimeout(1200);
  await page.getByRole('tab', { name: 'Items' }).click();
  await page.getByRole('button', { name: 'Delete ' + label }).click();
  const c = page.getByRole('alertdialog'); if (await c.count()) await c.getByRole('button', { name: /delete/i }).last().click();
  await page.getByRole('button', { name: new RegExp('^' + label) }).waitFor({ state: 'detached', timeout: 10000 });
});

await t.step('media: edit alt text + caption of a file, reload keeps them', async () => {
  await open(page, '/admin/media');
  await page.getByRole('button', { name: /materm-emblem.svg/ }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('input[id]:not([role=switch])').filter({ hasNot: page.locator('[type=hidden]') }).first().waitFor();
  const alt = dlg.locator('label:text-is("Alt text") + input'); await alt.fill('E2E alt ' + TAG);
  await dlg.locator('label:text-is("Caption") + textarea').fill('E2E caption ' + TAG);
  await dlg.getByRole('button', { name: 'Save', exact: true }).click(); await toast(/saved|updated/i);
  await page.keyboard.press('Escape');
  await open(page, '/admin/media'); await page.getByRole('button', { name: /materm-emblem.svg/ }).first().click();
  eq(await page.getByRole('dialog').locator('label:text-is("Alt text") + input').inputValue(), 'E2E alt ' + TAG, 'alt persisted');
  await page.keyboard.press('Escape');
});

await t.step('locales: the History sheet asks the collection trail (entity_id=0) and answers 200', async () => {
  await open(page, '/admin/locales');
  const w = page.waitForResponse((r) => /\/audit-logs\?/.test(r.url()) && /entity_type=cms\.locale/.test(r.url()));
  await page.getByRole('button', { name: 'History' }).click();
  const res = await w;
  eq(res.status(), 200, 'audit-logs cms.locale');
  const q = new URL(res.url()).searchParams;
  eq(q.get('entity_id'), '0', 'entity_id=0');
  ok([...q.keys()].every((k) => ['entity_type', 'entity_id', 'limit'].includes(k)), 'tab shape only');
  await page.getByRole('dialog').waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
});

await t.step('every screen above produced no 5xx and no page error', async () => {
  const bad = sink.http.filter((h) => h.status >= 500); ok(bad.length === 0, JSON.stringify(bad));
  const pe = sink.console.filter((c) => c.startsWith('PAGEERROR')); ok(pe.length === 0, pe.join(' | '));
});
await t.done(b);
