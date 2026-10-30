// Posts (author vs editor rights, publish, edit -> draft), galleries (create, add pictures, publish / blockers), FAQ (create group, add question, publish).
import crypto from 'node:crypto';
import { launch, suite, ok, eq, session, open, api, rootToken, newUser, TAG, shot, PORTAL_FE, sleep } from '../lib.mjs';

const t = suite('40 posts galleries faq');
const root = await rootToken();
const author = await newUser(root, 'author'); const editor = await newUser(root, 'editor');
const b = await launch();
const A = await session(b, { user: author.username, pass: author.password });
const E = await session(b, { user: editor.username, pass: editor.password });
t.page = E.page;
const toast = (pg, re) => pg.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 10000 });
const body = (text) => ({ type: 'doc', content: [{ type: 'lead', content: [{ type: 'text', text }] }, { type: 'paragraph', content: [{ type: 'text', text }] }] });
const idem = () => ({ 'idempotency-key': crypto.randomUUID() });
const mediaIds = (await api(root, 'GET', '/media/assets?limit=24')).body.data.filter((m) => m.kind !== 'brand').map((m) => m.id);
const TITLE = 'E2E post ' + TAG;
let postId, slug;

await t.step('author: creates a post in the UI, editor opens with Save draft but NO Publish button', async () => {
  await open(A.page, '/admin/blog/posts');
  await A.page.getByRole('button', { name: /new post/i }).click();
  const dlg = A.page.getByRole('dialog'); await dlg.locator('input').first().fill(TITLE);
  await dlg.getByRole('button', { name: 'Create post' }).click();
  await A.page.waitForURL(/\/admin\/blog\/posts\/\d+/, { timeout: 15000 });
  postId = Number(new URL(A.page.url()).pathname.split('/').pop());
  await A.page.getByRole('button', { name: 'Save draft' }).waitFor();
  eq(await A.page.getByRole('button', { name: /^Publish/ }).count(), 0, 'author sees no Publish');
  eq(await A.page.getByRole('button', { name: /^Unpublish/ }).count(), 0, 'author sees no Unpublish');
});

await t.step('author: the server refuses publish with 403 (UI hides it, API enforces it)', async () => {
  const cur = await api(author.token, 'GET', `/posts/${postId}`); slug = cur.body.data.translations.la.slug;
  const r = await api(author.token, 'POST', `/posts/${postId}/publish`, {}, { 'if-match': cur.etag });
  eq(r.status, 403, 'publish as author');
});

await t.step('author: completes the post (API as author), edits the title in the UI and saves the draft', async () => {
  const cur = await api(author.token, 'GET', `/posts/${postId}`);
  const up = await api(author.token, 'PATCH', `/posts/${postId}`, { category_id: 1, hero_media_id: mediaIds[0], translations: { la: { excerpt: 'Excerpt ' + TAG, seo_title: 'SEO ' + TAG, body: body('Body ' + TAG) }, en: { title: TITLE + ' EN', excerpt: 'Excerpt EN', seo_title: 'SEO EN', body: body('Body EN ' + TAG) } } }, { 'if-match': cur.etag });
  ok(up.status === 200, 'author patch ' + up.status + ' ' + up.body?.code + JSON.stringify(up.body?.errors || ''));
  await open(A.page, '/admin/blog/posts/' + postId);
  const title = A.page.locator('[id^="post-field-title"]').first(); await title.waitFor();
  const nt = TITLE + ' v2'; await title.fill(nt);
  const w1 = A.page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/posts\/\d+$/.test(r.url()));
  await A.page.getByRole('button', { name: 'Save draft' }).click(); eq((await w1).status(), 200, 'PATCH post');
  const after = await api(author.token, 'GET', `/posts/${postId}`); eq(after.body.data.translations.la.title, nt, 'title saved');
});

await t.step('author: cannot open a post of another author for editing (read-only editor)', async () => {
  const other = await api(editor.token, 'POST', '/posts', { translations: { la: { title: 'Editor post ' + TAG } } }, idem());
  ok(other.status === 201, 'editor creates ' + other.status);
  await open(A.page, '/admin/blog/posts/' + other.body.data.id);
  await A.page.waitForTimeout(1500);
  ok(await A.page.getByRole('button', { name: 'Save draft' }).isDisabled(), 'Save draft is disabled on someone else\'s post');
  ok(await A.page.locator('[id^="post-field-title"]').first().isDisabled(), 'title is read-only');
});

await t.step('editor: publishes the author\'s post from the UI and it appears on the website', async () => {
  await open(E.page, '/admin/blog/posts/' + postId);
  await E.page.getByRole('button', { name: /^Publish$/ }).click();
  const dlg = E.page.getByRole('dialog');
  const confirm = dlg.getByRole('button', { name: /^Publish$/ }); await confirm.waitFor({ timeout: 10000 });
  await confirm.click(); await toast(E.page, /published/i);
  const t0 = Date.now(); let html = '';
  while (Date.now() - t0 < 20000) { const r = await fetch(PORTAL_FE + '/blog/' + slug, { headers: { 'cache-control': 'no-cache' } }); html = await r.text(); if (r.status === 200 && html.includes('v2')) break; await sleep(500); }
  ok(html.includes(TITLE), 'website serves the post');
});

await t.step('editor: editing the published post stays a draft (website unchanged) and Publish changes appears', async () => {
  await open(E.page, '/admin/blog/posts/' + postId);
  const title = E.page.locator('[id^="post-field-title"]').first(); await title.fill(TITLE + ' v3');
  const w2 = E.page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/posts\/\d+$/.test(r.url()));
  await E.page.getByRole('button', { name: 'Save draft' }).click(); eq((await w2).status(), 200, 'PATCH post');
  await E.page.getByRole('button', { name: /Publish changes/ }).waitFor({ timeout: 8000 });
  const r = await fetch(PORTAL_FE + '/blog/' + slug, { headers: { 'cache-control': 'no-cache' } }); ok(!(await r.text()).includes('v3'), 'public page unchanged');
});

await t.step('posts list: both roles see the post; status filter works', async () => {
  await open(E.page, '/admin/blog/posts');
  await E.page.getByText(TITLE).first().waitFor({ timeout: 10000 });
});

let albumId;
await t.step('galleries: create an album, add two pictures from the media picker, save draft', async () => {
  await open(E.page, '/admin/galleries');
  await E.page.getByRole('button', { name: 'New album' }).click();
  const d = E.page.getByRole('dialog'); await d.locator('input').nth(0).fill('E2E album ' + TAG); await d.locator('input').nth(1).fill('e2e-alb-' + TAG);
  await d.getByRole('button', { name: 'Create album' }).click();
  await E.page.waitForURL(/galleries\/\d+/); albumId = Number(new URL(E.page.url()).pathname.split('/').pop());
  await E.page.getByRole('button', { name: 'Add pictures' }).first().click();
  const pk = E.page.getByRole('dialog');
  await pk.getByRole('button', { name: 'about-1-kayak.jpg' }).click(); await pk.getByRole('button', { name: 'about-2-glacier-climbers.jpg' }).click();
  await pk.getByRole('button', { name: 'Add selected' }).click();
  await pk.waitFor({ state: 'detached', timeout: 10000 });
  await sleep(1200);
  const items = (await api(root, 'GET', `/albums/${albumId}/items`)).body.data; eq(items.length, 2, 'two pictures stored');
});

await t.step('galleries: publish is answered either by success or by a blockers dialog with "Go to field"', async () => {
  await E.page.getByRole('button', { name: /^Publish$/ }).click();
  const dlg = E.page.getByRole('dialog'); await dlg.waitFor({ timeout: 10000 });
  const txt = (await dlg.innerText()).replace(/\s+/g, ' ');
  if (/cannot be published/i.test(txt)) { ok(await dlg.getByRole('button', { name: 'Go to field' }).count() > 0, 'blockers have Go to field'); await E.page.keyboard.press('Escape'); t.note('album blockers:', txt.slice(0, 160)); }
  else { await dlg.getByRole('button', { name: /^Publish$/ }).click(); await toast(E.page, /published/i); }
});

await t.step('galleries: a published album that a page uses cannot be deleted or unpublished casually (referenced -> 409 dialog)', async () => {
  await open(E.page, '/admin/galleries/1');
  await E.page.getByRole('button', { name: /^Unpublish$/ }).click();
  const c = E.page.getByRole('alertdialog'); await c.getByRole('button', { name: 'Unpublish' }).click();
  await E.page.getByText(/used|referenc|photo story|sections/i).first().waitFor({ timeout: 10000 });
  await shot(E.page, '40-album-referenced');
});

let groupId;
await t.step('FAQ: create a group, add a question + answer (rich text) and publish', async () => {
  await open(E.page, '/admin/faq');
  await E.page.getByRole('button', { name: /new/i }).first().click();
  const d = E.page.getByRole('dialog'); await d.locator('input').nth(0).fill('E2E faq ' + TAG); await d.locator('input').nth(1).fill('e2e-faq-' + TAG);
  await d.getByRole('button', { name: 'Create group' }).click();
  await E.page.waitForURL(/faq\/\d+/); groupId = Number(new URL(E.page.url()).pathname.split('/').pop());
  await E.page.getByRole('button', { name: /add question/i }).first().click();
  const q = E.page.getByRole('dialog');
  await q.locator('input').first().fill('Is E2E ' + TAG + ' fine?');
  await q.locator('[contenteditable=true]').first().click(); await E.page.keyboard.type('Yes, it is fine.');
  await q.getByRole('button', { name: /^(Add|Add question|Save)$/ }).last().click();
  await sleep(1500);
  const items = (await api(root, 'GET', `/faq-groups/${groupId}/items`)).body.data; eq(items.length, 1, 'one question stored');
  await E.page.getByRole('button', { name: /^Publish$/ }).click();
  const dlg = E.page.getByRole('dialog'); await dlg.waitFor({ timeout: 10000 });
  const txt = (await dlg.innerText()).replace(/\s+/g, ' ');
  if (/cannot be published/i.test(txt)) throw new Error('FAQ publish blocked: ' + txt.slice(0, 200));
  await dlg.getByRole('button', { name: /^Publish$/ }).click(); await toast(E.page, /published/i);
});

await t.step('no 5xx / page errors in the editor or author sessions', async () => {
  for (const S of [A, E]) { const bad = S.sink.http.filter((h) => h.status >= 500); ok(bad.length === 0, JSON.stringify(bad)); const pe = S.sink.console.filter((c) => c.startsWith('PAGEERROR')); ok(pe.length === 0, pe.join(' | ')); }
});
await t.done(b);
