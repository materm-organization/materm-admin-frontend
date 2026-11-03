// Redirects CSV import (dry run -> apply, update, export -> import round trip, refused apply) and authors (create, assign to a post, delete blocked while
// it has posts, trash / restore, inactive author, duplicate account link) against the real backend.
// The import rate limit is 20 per hour per user and dry runs count: this spec uses a fresh editor and about 6 calls.
import crypto from 'node:crypto';
import { launch, suite, ok, eq, session, open, api, rootToken, newUser, TAG, shot, ADMIN_BE } from '../lib.mjs';

const t = suite('70 redirects import authors');
const root = await rootToken();
const editor = await newUser(root, 'editor');
const b = await launch();
const E = await session(b, { user: editor.username, pass: editor.password });
const R = await session(b, {});
t.page = E.page;
const toast = (pg, re) => pg.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 10000 });
const idem = () => ({ 'idempotency-key': crypto.randomUUID() });
const csv = (...rows) => ({ name: 'redirects.csv', mimeType: 'text/csv', buffer: Buffer.from(['from,to,code', ...rows].join('\r\n') + '\r\n') });
const A = `/e2e-imp-${TAG}-a`; const B2 = `/e2e-imp-${TAG}-b`;
const redirectBy = async (path) => (await api(root, 'GET', '/redirects?keyword=' + encodeURIComponent(path))).body.data.find((r) => r.source_path === path);
let dialog;

await t.step('redirects: the Import dialog checks a file with an error first (dry run), shows the row error, and Apply is not offered', async () => {
  await open(E.page, '/admin/redirects');
  await E.page.getByRole('button', { name: 'Import CSV' }).click();
  dialog = E.page.getByRole('dialog');
  await dialog.getByTestId('redirect-import-input').setInputFiles(csv(`${A},/blog,301`, `no-slash-${TAG},/blog,301`));
  const w = E.page.waitForResponse((r) => r.url().includes('/redirects/import'));
  await dialog.getByRole('button', { name: 'Check file' }).click();
  const res = await w; eq(res.status(), 200, 'dry run status'); ok(res.url().includes('dry_run=true'), 'dry_run=true is sent');
  await dialog.getByTestId('redirect-import-totals').waitFor();
  ok(/Errors\s*1/.test(await dialog.getByTestId('redirect-import-totals').innerText()), 'one error counted');
  await dialog.getByText('The old address must start with /.').waitFor();
  eq(await dialog.getByRole('button', { name: /^Import \d/ }).isDisabled(), true, 'Apply disabled for an invalid file');
  eq(await redirectBy(A), undefined, 'a dry run writes nothing');
  await shot(E.page, '70-import-errors');
});

await t.step('redirects: a valid file -> dry run -> Apply (dry_run=false) creates the rows and the list shows them', async () => {
  await dialog.getByTestId('redirect-import-input').setInputFiles(csv(`${A},/blog,301`, `${B2},/gallery,308`));
  await dialog.getByRole('button', { name: 'Check file' }).click();
  await dialog.getByRole('button', { name: 'Import 2 changes' }).waitFor();
  eq(await dialog.getByRole('button', { name: 'Import 2 changes' }).isEnabled(), true, 'Apply enabled when valid');
  await shot(E.page, '70-import-valid');
  const w = E.page.waitForResponse((r) => r.url().includes('/redirects/import') && r.url().includes('dry_run=false'));
  await dialog.getByRole('button', { name: 'Import 2 changes' }).click();
  eq((await w).status(), 200, 'apply status');
  await toast(E.page, /Imported: 2 new/);
  await E.page.getByRole('dialog').waitFor({ state: 'detached', timeout: 8000 });
  await E.page.getByText(A).first().waitFor({ timeout: 10000 });
  const row = await redirectBy(B2); ok(row && row.status_code === 308 && row.target === '/gallery' && row.locale_code === null, 'row written for every language');
});

let updatedId;
await t.step('redirects: importing a changed code updates the row (previous value shown) and keeps it after Apply', async () => {
  updatedId = (await redirectBy(A)).id;
  await E.page.getByRole('button', { name: 'Import CSV' }).click();
  dialog = E.page.getByRole('dialog');
  await dialog.getByTestId('redirect-import-input').setInputFiles(csv(`${A},/blog,302`));
  await dialog.getByRole('button', { name: 'Check file' }).click();
  const row = dialog.getByTestId('redirect-import-row'); await row.waitFor();
  eq(await row.getAttribute('data-status'), 'updated', 'status');
  ok((await row.innerText()).includes('/blog (301)'), 'previous value');
  await dialog.getByRole('button', { name: 'Import 1 change' }).click();
  await toast(E.page, /1 updated/);
  eq((await redirectBy(A)).status_code, 302, 'updated');
  const hist = await api(root, 'GET', `/redirects/${updatedId}/revisions`); ok(hist.body.data.length >= 1, 'a revision of the old state');
});

await t.step('redirects: export -> import of the same file gives only `unchanged` rows (locale_code=none, no language column)', async () => {
  const exp = await fetch(ADMIN_BE + '/api/v1/redirects/export?locale_code=none', { headers: { authorization: 'Bearer ' + root } });
  eq(exp.status, 200, 'export'); const text = await exp.text(); ok(text.includes(A), 'export holds the new row');
  const fd = new FormData(); fd.append('file', new Blob([text], { type: 'text/csv' }), 'export.csv');
  const r = await fetch(ADMIN_BE + '/api/v1/redirects/import?dry_run=true', { method: 'POST', headers: { authorization: 'Bearer ' + editor.token }, body: fd });
  const j = await r.json(); eq(r.status, 200, 'import status ' + JSON.stringify(j).slice(0, 200));
  eq(j.data.valid, true, 'valid'); eq(j.data.totals.created, 0, 'created'); eq(j.data.totals.updated, 0, 'updated'); eq(j.data.totals.errors, 0, 'errors');
  eq(j.data.totals.unchanged, j.data.totals.rows, 'all unchanged');
});

await t.step('redirects: a real import with a bad row is a 422 with the full report in details.report and writes nothing', async () => {
  const fd = new FormData(); fd.append('file', new Blob([`from,to,code\r\n/e2e-imp-${TAG}-c,/blog,301\r\nbad-${TAG},/blog,301\r\n`], { type: 'text/csv' }), 'bad.csv');
  const r = await fetch(ADMIN_BE + '/api/v1/redirects/import?dry_run=false', { method: 'POST', headers: { authorization: 'Bearer ' + editor.token }, body: fd });
  const j = await r.json(); eq(r.status, 422, 'status'); eq(j.errors[0].code, 'has_errors', 'code');
  eq(j.details.report.applied, false, 'applied'); eq(j.details.report.rows.length, 2, 'rows in the report');
  eq(await redirectBy(`/e2e-imp-${TAG}-c`), undefined, 'nothing written');
});

const NAME = `E2E Author ${TAG}`;
let authorId, postId;
await t.step('authors: create an author in the UI (name, job title); it appears in the list and in the API', async () => {
  await open(E.page, '/admin/blog/authors');
  await E.page.getByRole('button', { name: 'New author' }).click();
  const dlg = E.page.getByRole('dialog');
  await dlg.getByLabel(/Display name/).fill(NAME);
  await dlg.getByLabel('Job title').nth(1).fill('Guide ' + TAG);
  await dlg.getByRole('button', { name: 'Create author' }).click();
  await toast(E.page, /Author created/);
  await E.page.getByText(NAME).first().waitFor({ timeout: 10000 });
  const list = await api(root, 'GET', '/authors?keyword=' + TAG); const a = list.body.data.find((x) => x.display_name === NAME);
  ok(a && a.translations.en.job_title === 'Guide ' + TAG && a.post_count === 0 && a.is_active === true, 'created');
  authorId = a.id; await shot(E.page, '70-authors-list');
});

await t.step('authors: assign the author to a post in the editor (Details tab), Save draft; the API and the posts list show it', async () => {
  const created = await api(editor.token, 'POST', '/posts', { translations: { la: { title: 'E2E byline post ' + TAG } } }, idem());
  eq(created.status, 201, 'post'); postId = created.body.data.id;
  await open(E.page, `/admin/blog/posts/${postId}?tab=details`);
  await E.page.getByRole('combobox', { name: /^Author/ }).click();
  await E.page.getByRole('option', { name: NAME }).click();
  const w = E.page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/posts\/\d+$/.test(r.url()));
  await E.page.getByRole('button', { name: 'Save draft' }).click(); eq((await w).status(), 200, 'PATCH post');
  const post = await api(editor.token, 'GET', `/posts/${postId}`);
  eq(post.body.data.author_id, authorId, 'author_id'); eq(post.body.data.author_name, NAME, 'author_name');
  await shot(E.page, '70-post-author');
  await open(E.page, '/admin/blog/posts');
  await E.page.getByRole('row').filter({ hasText: 'E2E byline post ' + TAG }).getByText(NAME).waitFor({ timeout: 10000 });
});

await t.step('authors: deleting an author that has posts is blocked (409 author_has_posts) and the dialog says how many', async () => {
  await open(E.page, '/admin/blog/authors');
  await E.page.getByRole('button', { name: 'Delete ' + NAME }).click();
  await E.page.getByRole('alertdialog').getByRole('button', { name: 'Move to trash' }).click();
  const dlg = E.page.getByTestId('author-has-posts'); await dlg.waitFor({ timeout: 10000 });
  ok(/1 post still names this author/.test(await dlg.innerText()), 'post count in the dialog');
  await shot(E.page, '70-author-blocked');
  await E.page.keyboard.press('Escape');
  const raw = await api(editor.token, 'DELETE', `/authors/${authorId}`, undefined, { 'if-match': (await api(editor.token, 'GET', `/authors/${authorId}`)).etag });
  eq(raw.status, 409, 'API status'); eq(raw.body.details.reason, 'author_has_posts', 'reason'); eq(raw.body.details.post_count, 1, 'post_count');
});

await t.step('authors: an author switched off cannot be chosen for another post (422 author_inactive) but stays on the post that has it', async () => {
  const cur = await api(editor.token, 'GET', `/authors/${authorId}`);
  const off = await api(editor.token, 'PATCH', `/authors/${authorId}`, { is_active: false }, { 'if-match': cur.etag }); eq(off.status, 200, 'switch off');
  const other = await api(editor.token, 'POST', '/posts', { translations: { la: { title: 'E2E other post ' + TAG } } }, idem());
  const bad = await api(editor.token, 'PATCH', `/posts/${other.body.data.id}`, { author_id: authorId }, { 'if-match': other.etag });
  eq(bad.status, 422, 'status'); eq(bad.body.errors[0].code, 'author_inactive', 'code');
  await open(E.page, `/admin/blog/posts/${postId}?tab=details`);
  await E.page.getByRole('combobox', { name: /^Author/ }).filter({ hasText: NAME }).waitFor({ timeout: 10000 });
  ok(/switched off/.test(await E.page.getByTestId('post-author').innerText()), 'marked as switched off');
  await shot(E.page, '70-post-author-inactive');
  const back = await api(editor.token, 'GET', `/authors/${authorId}`);
  await api(editor.token, 'PATCH', `/authors/${authorId}`, { is_active: true }, { 'if-match': back.etag });
});

await t.step('authors: after the post gives the author up, delete works; the trash lists it and restore brings it back', async () => {
  const post = await api(editor.token, 'GET', `/posts/${postId}`);
  eq((await api(editor.token, 'PATCH', `/posts/${postId}`, { author_id: null }, { 'if-match': post.etag })).status, 200, 'clear author');
  await open(E.page, '/admin/blog/authors');
  await E.page.getByRole('button', { name: 'Delete ' + NAME }).click();
  await E.page.getByRole('alertdialog').getByRole('button', { name: 'Move to trash' }).click();
  await toast(E.page, /moved to the trash/i);
  await open(E.page, '/admin/blog/authors?trashed=true');
  await E.page.getByRole('button', { name: 'Restore ' + NAME }).click();
  await toast(E.page, /Author restored/);
  eq((await api(root, 'GET', `/authors/${authorId}`)).body.data.deleted_at, null, 'restored');
});

await t.step('authors: Versions and Activity tabs of the dialog (revision of the edits above, audit entity cms.author)', async () => {
  await open(E.page, '/admin/blog/authors');
  await E.page.getByRole('button', { name: 'Edit ' + NAME }).click();
  const dlg = E.page.getByRole('dialog');
  await dlg.getByRole('tab', { name: 'Versions' }).click();
  await dlg.getByRole('button', { name: /Restore version/ }).first().waitFor({ timeout: 10000 });
  await dlg.getByRole('tab', { name: 'Activity' }).click();
  await dlg.getByText(/cms\.author\./).first().waitFor({ timeout: 10000 });
  await shot(E.page, '70-author-activity');
  await E.page.keyboard.press('Escape');
});

await t.step('authors: linking an account that already has an author is a 409 shown at the account field (UI, as admin)', async () => {
  const acc = await newUser(root, 'viewer');
  await open(R.page, '/admin/blog/authors');
  const mk = async (name) => {
    await R.page.getByRole('button', { name: 'New author' }).click();
    const dlg = R.page.getByRole('dialog');
    await dlg.getByLabel(/Display name/).fill(name);
    await dlg.getByRole('combobox', { name: 'Sign-in account' }).click();
    await R.page.getByRole('option', { name: new RegExp(acc.username.replace(/\./g, '\\.')) }).click();
    await dlg.getByRole('button', { name: 'Create author' }).click();
    return dlg;
  };
  await mk(`E2E linked ${TAG}`); await toast(R.page, /Author created/);
  const second = await mk(`E2E linked twice ${TAG}`);
  await second.getByText('This account is already linked to another author.').waitFor({ timeout: 10000 });
  await shot(R.page, '70-author-duplicate-user');
  await R.page.keyboard.press('Escape');
});

await t.done(E.ctx, R.ctx, b);
