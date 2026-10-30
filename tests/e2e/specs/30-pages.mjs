// Pages: create from a template, publish blockers + Go to field, fill sections through the schema form, publish, edit -> draft, discard,
// History restore as draft, add a section, unpublish, preview link dialog. (The deep preview-link flow, 20-link cap, Lao message and the
// unsaved-edits warning are covered by ../../../e2e-cross-system/55-preview-ui.mjs; the portal propagation timings by 30/45/60.)
import { launch, suite, ok, eq, session, open, api, rootToken, TAG, shot, PORTAL_FE, sleep } from '../lib.mjs';

const t = suite('30 pages');
const root = await rootToken();
const b = await launch();
const { page, sink } = await session(b, { viewport: { width: 1440, height: 1300 } });
t.page = page;
const PATH = '/e2e-pages-' + TAG; const TL = 'E2E_TITLE_LA_' + TAG; const TE = 'E2E_TITLE_EN_' + TAG;
const toast = (re) => page.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 10000 });
const portal = async (p) => { const r = await fetch(PORTAL_FE + p, { headers: { 'cache-control': 'no-cache' } }); return { status: r.status, html: await r.text() }; };
const waitPortal = async (p, pred, ms = 20000) => { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await portal(p); if (pred(last)) return last; await sleep(400); } throw new Error('portal ' + p + ' did not reach the expected state; last status ' + last?.status); };
const lang = (l) => page.getByRole('radio', { name: l === 'la' ? /^LAO/i : /^EN/i }).first().click();
let pageId; const dlgText = () => page.evaluate(() => document.querySelector('[role=dialog],[role=alertdialog]')?.innerText.replace(/\s+/g, ' ') || '');

await t.step('pages list: create a page from the Standard template and land in the editor', async () => {
  await open(page, '/admin/pages');
  await page.getByRole('button', { name: /new page/i }).click();
  const dlg = page.getByRole('dialog'); const ins = dlg.locator('input');
  await ins.nth(0).fill('E2E pages ' + TAG); await ins.nth(1).fill(PATH);
  await dlg.getByRole('button', { name: 'Create page' }).click();
  await page.waitForURL(/\/admin\/pages\/\d+/, { timeout: 15000 });
  pageId = Number(new URL(page.url()).pathname.split('/').pop()); ok(pageId > 0, 'id');
  await page.getByRole('button', { name: /^Publish$/ }).waitFor();
});

await t.step('publish of the empty page is blocked; the dialog lists blockers and Go to field focuses the hero title', async () => {
  await page.getByRole('button', { name: /^Publish$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Go to field' }).first().waitFor({ timeout: 10000 });
  ok(/cannot be published|blocked/i.test(await dlgText()), 'blockers dialog: ' + (await dlgText()).slice(0, 120));
  ok(sink.http.some((h) => h.code === 'PUBLISH_BLOCKED'), 'server answered PUBLISH_BLOCKED');
  const gotos = page.getByRole('button', { name: 'Go to field' }); await gotos.nth((await gotos.count()) - 1).click();
  await page.waitForTimeout(1500);
  const focus = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  ok(/title_la/.test(focus) || page.url().includes('section='), 'focused ' + focus);
});

await t.step('hero: fill the Lao + English title, pick an image from the media library, alt text, save the section', async () => {
  await page.locator('textarea[id$="_title_la"]').first().fill(TL);
  await page.getByRole('button', { name: 'Choose image' }).click();
  await page.getByRole('button', { name: 'hero-bg-forest.jpg' }).first().click();
  await page.locator('input[id$="_background_alt_la"]').fill('E2E hero alt');
  await lang('en');
  await page.locator('textarea[id$="_title_en"]').first().fill(TE);
  await page.getByRole('button', { name: 'Save section' }).click(); await page.waitForTimeout(2000);
  const bad = sink.http.filter((h) => /sections/.test(h.path) && h.status >= 400); ok(bad.length === 0, JSON.stringify(bad));
  const secs = (await api(root, 'GET', `/pages/${pageId}/sections?include=props`)).body.data;
  eq(secs[0].props.title.la, TL, 'saved on the server');
});

await t.step('SEO tab: the default-language SEO title is required for publish; Save draft', async () => {
  await page.getByRole('tab', { name: 'SEO' }).click();
  await page.locator('#page-field-seo_title-la').waitFor({ state: 'attached' }).catch(() => {});
  await shot(page, '30-seo-tab');
  await page.locator('#page-field-seo_title-la').fill('E2E SEO ' + TAG);
  await page.getByRole('button', { name: 'Save draft' }).click(); await page.waitForTimeout(1800);
  await page.getByRole('tab', { name: 'Content' }).click();
});

await t.step('publish: confirm dialog, success toast, the website serves the page', async () => {
  await page.getByRole('button', { name: /^Publish$/ }).click();
  const dlg = page.getByRole('dialog'); await dlg.getByRole('button', { name: /^Publish$/ }).click({ timeout: 10000 });
  await toast(/published/i);
  const r = await waitPortal(PATH, (x) => x.status === 200 && x.html.includes(TL)); ok(r.html.includes(TL), 'portal html');
});

await t.step('editing a published page keeps the website unchanged (draft) and shows Publish changes', async () => {
  const TL1 = TL + '_v1';
  await lang('la');
  await page.locator('textarea[id$="_title_la"]').first().fill(TL1);
  await page.getByRole('button', { name: 'Save section' }).click(); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Publish changes/ }).waitFor();
  const r = await portal(PATH); ok(r.html.includes(TL) && !r.html.includes(TL1), 'public page still has the old title');
});

await t.step('discard changes: the editor goes back to the published version', async () => {
  await page.getByRole('button', { name: 'Discard changes' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
  await toast(/discarded/i);
  await page.waitForTimeout(1500);
  const secs = (await api(root, 'GET', `/pages/${pageId}/sections?include=props`)).body.data; eq(secs[0].props.title.la, TL, 'draft equals live again');
});

await t.step('History tab: restore an earlier version as the working draft (website unchanged)', async () => {
  // make a second published version first
  const TL2 = TL + '_v2';
  await lang('la');
  await page.locator('textarea[id$="_title_la"]').first().fill(TL2);
  await page.getByRole('button', { name: 'Save section' }).click(); await page.waitForTimeout(1800);
  await page.getByRole('button', { name: /Publish changes/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish changes' }).click(); await toast(/published/i);
  await waitPortal(PATH, (x) => x.html.includes(TL2));
  await page.getByRole('tab', { name: 'History' }).click(); await page.waitForTimeout(1500);
  const restore = page.getByRole('button', { name: /Restore.*as draft/ }).nth(1); await restore.waitFor({ timeout: 10000 });
  await restore.click();
  await page.getByRole('dialog').getByRole('button', { name: /Restore version/ }).click();
  await page.waitForTimeout(2000);
  const r = await portal(PATH); ok(r.html.includes(TL2), 'website still shows the live version after a restore as draft');
  const detail = (await api(root, 'GET', `/pages/${pageId}`)).body.data; ok(detail.has_unpublished_changes === true, 'restored version is a pending draft');
});

await t.step('add a section from the picker (Intro heading)', async () => {
  await page.getByRole('tab', { name: 'Content' }).click();
  await page.locator('#add-section-button').click();
  await page.getByRole('dialog').getByText('Intro heading').first().click(); await page.waitForTimeout(2200);
  const secs = (await api(root, 'GET', `/pages/${pageId}/sections`)).body.data; eq(secs.length, 2, 'two sections');
});

await t.step('preview link dialog: create a link, the URL is shown once, the draft opens on the website', async () => {
  await page.getByRole('button', { name: /^Preview$/ }).click();
  await page.getByTestId('preview-create').click();
  await page.getByTestId('preview-url').waitFor({ timeout: 15000 });
  const url = await page.getByTestId('preview-url').inputValue(); ok(/^http/.test(url), 'url');
  const v = await b.newContext(); const pp = await v.newPage();
  const resp = await pp.goto(url, { waitUntil: 'networkidle' }); ok(resp.status() < 400, 'preview opens ' + resp.status());
  ok(new URL(pp.url()).pathname === PATH && !/token/.test(pp.url()), 'landed on the page without the token in the address');
  await v.close();
  await page.getByRole('button', { name: /^Done$/ }).click();
});

await t.step('unpublish: the page disappears from the website (404)', async () => {
  await page.getByRole('button', { name: /^Unpublish$/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Unpublish' }).click(); await toast(/unpublished/i);
  await waitPortal(PATH, (x) => x.status === 404);
});

await t.step('pages list shows the page; trash it and it leaves the list', async () => {
  await open(page, '/admin/pages?q=' + encodeURIComponent('E2E pages ' + TAG));
  const row = page.locator('tr', { hasText: 'E2E pages ' + TAG }); await row.waitFor({ timeout: 10000 });
  await row.getByRole('button', { name: /actions|more|menu/i }).last().click();
  await page.getByRole('menuitem', { name: /trash|delete/i }).click();
  const c = page.getByRole('alertdialog'); await c.getByRole('button').last().click();
  await row.waitFor({ state: 'detached', timeout: 10000 });
});

await t.step('no 5xx / page errors during the page flow', async () => {
  const bad = sink.http.filter((h) => h.status >= 500); ok(bad.length === 0, JSON.stringify(bad));
  const pe = sink.console.filter((c) => c.startsWith('PAGEERROR')); ok(pe.length === 0, pe.join(' | '));
});
await t.done(b);
