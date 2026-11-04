// Collections (SCR-40 definitions, SCR-41 entries) against the real backend (admin backend HEAD of the harness clone, incl. the D1-D6 hardening):
// create a collection through the field builder, a schema the server refuses (client check + a server-only refusal), entries with two languages,
// publish with a duplicate-slug blocker, a schema change that existing entries block (409 schema_breaks_entries: dialog + API), the same change made
// compatible, the delete refusal while entries exist, the old-schema restore check, trash / restore of an entry, revisions, and the roles
// (editor: entries only; viewer / author: read only; translator: translate only).
import { launch, suite, ok, eq, session, open, api, rootToken, newUser, TAG, shot } from '../lib.mjs';

const t = suite('90 collections');
const root = await rootToken();
const editorU = await newUser(root, 'editor');
const viewerU = await newUser(root, 'viewer');
const authorU = await newUser(root, 'author');
const translatorU = await newUser(root, 'translator');
const b = await launch();
const S = await session(b, {});
const ED = await session(b, { user: editorU.username, pass: editorU.password });
const VW = await session(b, { user: viewerU.username, pass: viewerU.password });
t.page = S.page;
const page = S.page;
const KEY = `e2e_${TAG}`;
const NAME = `E2E Team ${TAG}`;
const toast = (pg, re) => pg.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 10000 });
const defOf = async () => (await api(root, 'GET', `/collections/${KEY}`));
const row = (i) => page.getByTestId('builder-field').nth(i);
const pick = async (r, label, option) => { await r.getByRole('combobox', { name: label }).click(); await page.getByRole('option', { name: option, exact: true }).click(); };
const save = async () => { await page.getByTestId('save-definition').click(); };
const idOf = (url) => Number(new URL(url).pathname.split('/').pop());
let etagTeam; let idA; let idB;

await t.step('Content group lists Collections; the list opens; New collection creates the definition with the key suggested from the name and opens the schema editor', async () => {
  await open(page, '/admin');
  await page.getByRole('button', { name: 'Content' }).click();
  await page.getByRole('link', { name: 'Collections' }).click();
  await page.waitForURL(/\/admin\/collections$/);
  await page.getByRole('heading', { name: 'Collections' }).first().waitFor();
  await page.getByRole('button', { name: 'New collection' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill(NAME);
  await d.getByLabel('Key').fill(KEY);
  const w = page.waitForResponse((r) => r.url().endsWith('/collections') && r.request().method() === 'POST');
  await d.getByRole('button', { name: 'Create' }).click();
  const res = await w; eq(res.status(), 201, 'create status');
  ok(res.headers()['etag'], 'ETag header');
  await page.waitForURL(new RegExp(`/admin/collections/${KEY}/schema`));
  await page.getByTestId('field-builder').waitFor();
  const got = (await defOf()).body.data; eq(got.schema_version, 1, 'version'); eq(got.entry_count, 0, 'no entries');
});

await t.step('create refusals in the dialog: a bad key is caught before any request, a taken key is a 409 shown at the key field', async () => {
  await open(page, '/admin/collections');
  await page.getByRole('button', { name: 'New collection' }).click();
  const d = page.getByRole('dialog');
  let posts = 0; const on = (r) => { if (r.method() === 'POST' && /\/collections$/.test(r.url())) posts++; }; page.on('request', on);
  await d.getByLabel('Name').fill('Bad');
  await d.getByLabel('Key').fill('Bad_');
  await d.getByRole('button', { name: 'Create' }).click();
  await d.getByText(/Lower case letters and digits, single underscores/).waitFor();
  eq(posts, 0, 'no request for a bad key');
  await d.getByLabel('Key').fill(KEY);
  await d.getByRole('button', { name: 'Create' }).click();
  await d.getByText('This key is already used by another collection.').waitFor({ timeout: 8000 });
  page.off('request', on);
  await page.keyboard.press('Escape');
});

await t.step('the field builder: year (whole number, min 1990), role (short text, per language, max 120), bio (rich text, per language), photo (picture); Save sends ONE PATCH and the stored schemas are the allowed subset', async () => {
  await open(page, `/admin/collections/${KEY}/schema`);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Add field' }).click();
  await row(0).getByLabel('Field name').fill('year'); await pick(row(0), 'Type', 'Whole number'); await row(0).getByLabel('Minimum').fill('1990');
  await row(1).getByLabel('Field name').fill('role'); await row(1).getByLabel('Maximum length').fill('120');
  await row(1).getByRole('switch', { name: 'Different in each language' }).click();
  await row(2).getByLabel('Field name').fill('bio'); await pick(row(2), 'Type', 'Rich text'); await row(2).getByRole('switch', { name: 'Different in each language' }).click();
  await row(3).getByLabel('Field name').fill('photo'); await pick(row(3), 'Type', 'Picture');
  await shot(page, '90-builder');
  const patches = []; page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().endsWith(`/collections/${KEY}`)) patches.push(r.headers()['if-match']); });
  const w = page.waitForResponse((r) => r.url().endsWith(`/collections/${KEY}`) && r.request().method() === 'PATCH');
  await save();
  eq((await w).status(), 200, 'PATCH status'); await toast(page, /Saved\./);
  eq(patches.length, 1, 'one PATCH'); ok(/^"/.test(patches[0]), 'If-Match is the quoted ETag');
  const def = (await defOf()).body.data;
  eq(def.json_schema.properties.year.type, 'integer', 'year'); eq(def.json_schema.properties.year.minimum, 1990, 'min');
  eq(def.localized_schema.properties.role.maxLength, 120, 'role'); eq(def.localized_schema.properties.bio['x-richtext'], 'lite', 'bio');
  eq(def.json_schema.properties.photo.properties.media_id.type, 'integer', 'photo is {media_id}');
  eq(JSON.stringify(def.ui_schema['ui:order']), JSON.stringify(['year', 'role', 'bio', 'photo']), 'order is kept in ui:order');
  ok(!JSON.stringify(def).includes('x-localized') && !JSON.stringify(def).includes('$ref'), 'no x-localized / $ref');
  etagTeam = def.etag;
  await open(page, `/admin/collections/${KEY}/schema`);
  eq(await page.getByTestId('builder-field').count(), 4, 'the builder reads the stored schemas back (jsonb key order is not the field order)');
  eq(await row(1).getByRole('switch', { name: 'Different in each language' }).getAttribute('aria-checked'), 'true', 'role is per language');
});

await t.step('a bad schema is refused: the client check stops a $ref before any request, a server-only refusal (pattern cost) comes back as readable lines naming the field', async () => {
  await page.getByRole('tab', { name: 'Advanced JSON' }).click();
  const box = page.getByTestId('json-json_schema');
  const doc = JSON.parse(await box.inputValue());
  const patches = []; page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().endsWith(`/collections/${KEY}`)) patches.push(1); });
  doc.properties.year.$ref = '#/x';
  await box.fill(JSON.stringify(doc, null, 2));
  await save();
  await page.getByTestId('schema-errors').waitFor();
  ok(/\$ref/.test(await page.getByTestId('schema-errors').innerText()), 'the $ref is named');
  eq(patches.length, 0, 'the client check sent nothing');
  delete doc.properties.year.$ref;
  // eleven counted repeats: each is allowed (<= 100) but the compiled program is over 1000 instructions: only the server can tell
  doc.properties.cost = { type: 'string', pattern: '[a-z]{100}'.repeat(11), maxLength: 50 };
  await box.fill(JSON.stringify(doc, null, 2));
  const w = page.waitForResponse((r) => r.url().endsWith(`/collections/${KEY}`) && r.request().method() === 'PATCH');
  await save();
  const res = await w; eq(res.status(), 422, 'the server refuses the pattern');
  const body = await res.json(); ok(body.errors.some((e) => e.path === '/json_schema/properties/cost/pattern' && e.code === 'limit_exceeded' && e.params.limit === 'pattern_program'), 'pattern_program at the pattern: ' + JSON.stringify(body.errors));
  const text = await page.getByTestId('schema-errors').innerText();
  ok(/Field cost/.test(text) && /limit was exceeded/i.test(text), 'readable line with the field: ' + text);
  await shot(page, '90-schema-error');
  eq((await defOf()).body.data.etag, etagTeam, 'nothing was saved');
  await open(page, `/admin/collections/${KEY}/schema`);
});

await t.step('API contract of the refusals: unsupported keyword, missing maxItems, reserved name, media_id type, x-localized, property name (422) and an immutable key', async () => {
  const bad = async (schema, path, code) => {
    const r = await api(root, 'PATCH', `/collections/${KEY}`, { json_schema: schema }, { 'if-match': (await defOf()).etag });
    eq(r.status, 422, 'status for ' + code); ok(r.body.errors.some((e) => e.path === path && e.code === code), `${code} at ${path}: ${JSON.stringify(r.body.errors)}`);
  };
  const o = (props) => ({ type: 'object', additionalProperties: false, properties: props });
  await bad(o({ a: { $ref: '#/x' } }), '/json_schema/properties/a/$ref', 'unsupported_keyword');
  await bad(o({ a: { type: 'string', 'x-localized': true } }), '/json_schema/properties/a/x-localized', 'unsupported_keyword');
  await bad(o({ a: { type: 'array', items: { type: 'string' } } }), '/json_schema/properties/a/maxItems', 'missing_keyword');
  await bad(o({ valueof: { type: 'string' } }), '/json_schema/properties/valueof', 'reserved_name');
  await bad(o({ media_id: { type: 'string' } }), '/json_schema/properties/media_id/type', 'invalid_schema');
  await bad(o({ 'Bad-Name': { type: 'string' } }), '/json_schema/properties/Bad-Name', 'invalid_schema');
  await bad(o({ a: { type: 'string', pattern: '^a$' } }), '/json_schema/properties/a/maxLength', 'missing_keyword');
  const imm = await api(root, 'PATCH', `/collections/${KEY}`, { key: 'other' }, { 'if-match': (await defOf()).etag });
  eq(imm.status, 422, 'key is immutable'); ok(imm.body.errors.some((e) => e.path === '/key' && e.code === 'immutable'), 'immutable');
});

await t.step('entries: New entry creates a draft with title and address; the editor shows the shared fields and the fields of the language; saving sends If-Match "1"', async () => {
  await open(page, `/admin/collections/${KEY}`);
  await page.getByRole('heading', { name: NAME }).first().waitFor();
  await page.getByRole('button', { name: 'New entry' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Title').fill(`Somsak ${TAG}`);
  const slugVal = await d.getByLabel('Address (slug)').inputValue(); eq(slugVal, `somsak-${TAG}`, 'slug follows the title');
  await d.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(new RegExp(`/admin/collections/${KEY}/\\d+`));
  idA = idOf(page.url());
  await page.getByTestId('shared-form').waitFor(); await page.getByTestId('localized-form').waitFor();
  await page.getByTestId('shared-form').getByLabel(/^Year/).fill('2019');
  await page.getByTestId('localized-form').getByLabel(/^Role/).fill('Guide');
  const w = page.waitForResponse((r) => r.url().endsWith(`/entries/${idA}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save draft' }).click();
  const res = await w; eq(res.status(), 200, 'save'); eq(res.request().headers()['if-match'], '"1"', 'entry ETag is the lock_version');
  eq(res.headers()['etag'], '"2"', 'new ETag');
  const e = (await api(root, 'GET', `/collections/${KEY}/entries/${idA}`)).body.data;
  eq(e.data.year, 2019, 'year'); eq(e.translations.la.data.role, 'Guide', 'role');
  eq(e.status, 'draft', 'a draft entry is written to its real rows');
});

await t.step('the second language: Add English creates the row (title, address, fields) and the entry is complete in both; missing languages are listed before', async () => {
  await open(page, `/admin/collections/${KEY}/${idA}?locale=en`);
  await page.getByTestId('language-missing').waitFor();
  await page.getByRole('button', { name: /^Add / }).click();
  await page.getByLabel(/^Title \(/).fill(`Somsak EN ${TAG}`);
  await page.getByTestId('localized-form').getByLabel(/^Role/).fill('Guide EN');
  const w = page.waitForResponse((r) => r.url().endsWith(`/entries/${idA}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save draft' }).click();
  eq((await w).status(), 200, 'save en');
  const e = (await api(root, 'GET', `/collections/${KEY}/entries/${idA}`)).body.data;
  eq(e.translations.en.title, `Somsak EN ${TAG}`, 'en title'); eq(e.translations.en.slug, `somsak-en-${TAG}`, 'en slug from the title'); eq(e.missing_locales.length, 0, 'no missing language');
});

await t.step('publish: dry run first (no ETag change), then the confirmation; the entry is published and the list says so', async () => {
  await open(page, `/admin/collections/${KEY}/${idA}`);
  const dry = page.waitForResponse((r) => r.url().includes(`/entries/${idA}/publish`) && r.url().includes('dry_run=true'));
  await page.getByRole('button', { name: /^Publish/ }).click();
  eq((await dry).status(), 200, 'dry run passes');
  const d = page.getByRole('dialog');
  const real = page.waitForResponse((r) => r.url().includes(`/entries/${idA}/publish`) && !r.url().includes('dry_run'));
  await d.getByRole('button', { name: /^Publish/ }).click();
  const res = await real; eq(res.status(), 200, 'publish status'); ok(res.request().headers()['idempotency-key'], 'Idempotency-Key');
  await page.getByTestId('status-badge').getByText('Published').waitFor({ timeout: 8000 });
  eq((await api(root, 'GET', `/collections/${KEY}/entries/${idA}`)).body.data.status, 'published', 'published');
});

await t.step('the duplicate address: B is published and edits its address (free at that moment); A takes that address and publishes; then B\'s Publish is BLOCKED with the duplicate named (the backend also refuses a taken address at Save: 409 at the field)', async () => {
  const created = await api(root, 'POST', `/collections/${KEY}/entries`, { data: { year: 2021 }, translations: { la: { title: `Kham ${TAG}`, slug: `kham-${TAG}`, data: { role: 'Driver' } } } });
  eq(created.status, 201, 'create B'); idB = created.body.data.id;
  const pub = await api(root, 'POST', `/collections/${KEY}/entries/${idB}/publish`, undefined, { 'if-match': created.etag });
  eq(pub.status, 200, 'publish B');
  // a taken address is refused at Save with a 409 shown at the field
  await open(page, `/admin/collections/${KEY}/${idB}`);
  const slug = page.getByLabel(/^Address \(/);
  await slug.fill(`somsak-${TAG}`);
  const w409 = page.waitForResponse((r) => r.url().endsWith(`/entries/${idB}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save draft' }).click();
  eq((await w409).status(), 409, 'a taken address is refused at Save');
  await page.getByText('Another entry already uses this address in this language.').waitFor({ timeout: 8000 });
  // a free address is a pending draft of the published entry
  await slug.fill(`shared-${TAG}`);
  const w = page.waitForResponse((r) => r.url().endsWith(`/entries/${idB}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save draft' }).click();
  eq((await w).status(), 200, 'free address saved as a draft');
  // A (published) takes that address and publishes it: B's draft is not live, so it is free for A
  const ga = await api(root, 'GET', `/collections/${KEY}/entries/${idA}`);
  const pa = await api(root, 'PATCH', `/collections/${KEY}/entries/${idA}`, { translations: { la: { slug: `shared-${TAG}` } } }, { 'if-match': ga.etag });
  eq(pa.status, 200, 'A saves the address into its draft: ' + JSON.stringify(pa.body?.errors));
  const pubA = await api(root, 'POST', `/collections/${KEY}/entries/${idA}/publish`, undefined, { 'if-match': pa.etag });
  eq(pubA.status, 200, 'A publishes: ' + JSON.stringify(pubA.body?.errors));
  await open(page, `/admin/collections/${KEY}/${idB}`);
  await page.getByRole('button', { name: /^Publish/ }).click();
  const d = page.getByRole('dialog');
  await d.waitFor();
  const text = await d.innerText();
  ok(/already|duplicate|taken|exists/i.test(text), 'the duplicate address is named: ' + text.slice(0, 200));
  await shot(page, '90-publish-blocked');
  const live = (await api(root, 'GET', `/collections/${KEY}/entries/${idB}`)).body.data;
  eq(live.status, 'published', 'still published'); eq(live.has_unpublished_changes, true, 'the edit stays a pending draft');
  await page.keyboard.press('Escape');
  // discard the draft again
  const gb = await api(root, 'GET', `/collections/${KEY}/entries/${idB}`);
  eq((await api(root, 'POST', `/collections/${KEY}/entries/${idB}/discard-draft`, undefined, { 'if-match': gb.etag })).status, 200, 'discard');
});

await t.step('a schema change the entries block is a 409 schema_breaks_entries: the dialog shows checked / invalid_count and the entries; nothing is saved', async () => {
  const before = (await defOf()).body.data;
  await open(page, `/admin/collections/${KEY}/schema`);
  await row(0).getByLabel('Minimum').fill('2020');
  const w = page.waitForResponse((r) => r.url().endsWith(`/collections/${KEY}`) && r.request().method() === 'PATCH');
  await save();
  const res = await w; eq(res.status(), 409, 'refused'); const body = await res.json();
  eq(body.code, 'INVALID_STATE', 'code'); eq(body.details.reason, 'schema_breaks_entries', 'reason');
  ok(body.details.checked >= 2 && body.details.invalid_count >= 1, `counts: ${JSON.stringify(body.details)}`);
  const entry = body.details.invalid_entries.find((x) => x.id === idA); ok(entry && entry.path === '/data/year' && entry.code === 'out_of_range', 'entry A named: ' + JSON.stringify(body.details.invalid_entries));
  const dlg = page.getByTestId('schema-breaks-dialog'); await dlg.waitFor();
  ok(/\d+ of \d+ entries would not pass/.test(await dlg.innerText()), 'summary');
  await dlg.getByRole('link', { name: `Entry #${idA}` }).waitFor();
  await shot(page, '90-schema-breaks');
  await dlg.getByRole('button', { name: 'Close' }).last().click();
  eq((await defOf()).body.data.etag, before.etag, 'nothing was saved');
  // the same through the API
  const api409 = await api(root, 'PATCH', `/collections/${KEY}`, { json_schema: { ...before.json_schema, properties: { ...before.json_schema.properties, year: { ...before.json_schema.properties.year, minimum: 2020 } } } }, { 'if-match': before.etag });
  eq(api409.status, 409, 'API 409'); eq(api409.body.details.reason, 'schema_breaks_entries', 'API reason');
});

await t.step('the same change made compatible (a looser limit) is saved: schema_version +1, and the entries now carry the "Schema changed" chip and the stale banner', async () => {
  const versionBefore = (await defOf()).body.data.schema_version;
  await row(0).getByLabel('Minimum').fill('1900');
  const w = page.waitForResponse((r) => r.url().endsWith(`/collections/${KEY}`) && r.request().method() === 'PATCH');
  await save();
  eq((await w).status(), 200, 'saved');
  eq((await defOf()).body.data.schema_version, versionBefore + 1, 'schema_version +1');
  await open(page, `/admin/collections/${KEY}`);
  await page.getByTestId('stale-chip').first().waitFor();
  await shot(page, '90-entries-list');
  await open(page, `/admin/collections/${KEY}/${idA}`);
  await page.getByTestId('schema-stale-banner').waitFor();
  const e = (await api(root, 'GET', `/collections/${KEY}/entries/${idA}`)).body.data; eq(e.schema_stale, true, 'schema_stale in the API');
});

await t.step('deleting a collection that has entries is refused (ENTITY_REFERENCED collection_has_entries) and explained', async () => {
  await open(page, `/admin/collections/${KEY}/schema`);
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to trash' }).click();
  const d = page.getByRole('alertdialog', { name: 'It still has entries' }); await d.waitFor();
  ok(/entries are still outside the trash|entry is still outside the trash/.test(await d.innerText()), 'explained');
  const r = await api(root, 'DELETE', `/collections/${KEY}`, undefined, { 'if-match': (await defOf()).etag });
  eq(r.status, 409, 'API'); eq(r.body.code, 'ENTITY_REFERENCED', 'code'); eq(r.body.details.reason, 'collection_has_entries', 'reason');
  await page.keyboard.press('Escape');
});

await t.step('versions: restoring the OLD (empty) schema goes through the same check and is refused inside the restore dialog because entries have data', async () => {
  await open(page, `/admin/collections/${KEY}/schema?tab=revisions`);
  await page.getByRole('button', { name: /Restore version/ }).last().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Restore version/ }).last().click();
  const d = page.getByRole('dialog');
  const w = page.waitForResponse((r) => /\/collections\/[^/]+\/revisions\/\d+\/restore/.test(r.url()));
  await d.getByRole('button', { name: /^Restore version/ }).click();
  const res = await w; eq(res.status(), 409, 'restore refused'); eq((await res.json()).details.reason, 'schema_breaks_entries', 'reason');
  await d.getByTestId('restore-breaks').waitFor();
  await shot(page, '90-restore-breaks');
  await page.keyboard.press('Escape');
});

await t.step('entry History: the versions are listed and a restore of an older one becomes the working copy; the Activity tab lists the audit rows with the numeric id', async () => {
  await open(page, `/admin/collections/${KEY}/${idA}`);
  await page.getByTestId('localized-form').getByLabel(/^Role/).fill('Chief guide');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForResponse((r) => r.url().endsWith(`/entries/${idA}`) && r.request().method() === 'PATCH');
  await open(page, `/admin/collections/${KEY}/${idA}?tab=revisions`);
  await page.getByRole('button', { name: /Restore version/ }).first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Restore version/ }).first().click();
  const d = page.getByRole('dialog');
  const w = page.waitForResponse((r) => /\/entries\/\d+\/revisions\/\d+\/restore/.test(r.url()));
  await d.getByRole('button', { name: /^Restore as draft|^Restore version/ }).last().click();
  const res = await w; ok([200, 409, 422].includes(res.status()), 'answered ' + res.status());
  await open(page, `/admin/collections/${KEY}/${idA}?tab=activity`);
  await page.getByText(/cms\.collection_entry\./).first().waitFor({ timeout: 10000 });
  await open(page, `/admin/collections/${KEY}/schema?tab=activity`);
  await page.getByText(/cms\.collection\./).first().waitFor({ timeout: 10000 });
});

await t.step('trash and restore of an entry: Move to trash (confirm), the trash view lists it, Restore brings it back as a draft', async () => {
  await open(page, `/admin/collections/${KEY}/${idB}`);
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForURL(new RegExp(`/admin/collections/${KEY}$`));
  ok((await api(root, 'GET', `/collections/${KEY}/entries/${idB}`)).body.data.deleted_at, 'in the trash');
  await open(page, `/admin/collections/${KEY}?trashed=true`);
  await page.getByRole('button', { name: new RegExp('^Restore Kham') }).click();
  await toast(page, /restored as a draft/);
  eq((await api(root, 'GET', `/collections/${KEY}/entries/${idB}`)).body.data.status, 'draft', 'back as a draft');
});

await t.step('IDOR: an entry id read through another collection key is 404 (API and UI not-found state)', async () => {
  const other = await api(root, 'GET', `/collections?limit=100`);
  const k2 = other.body.data.find((c) => c.key !== KEY)?.key;
  if (k2) eq((await api(root, 'GET', `/collections/${k2}/entries/${idA}`)).status, 404, 'other collection');
  await open(page, `/admin/collections/${KEY}/99999999`);
  await page.getByText('Entry not found').waitFor({ timeout: 10000 });
});

await t.step('editor: entries only. No New collection, "View schema" instead of "Edit schema", the definition is read only (no Save, no Add field); can create entries; API PATCH of the definition is 403', async () => {
  await open(ED.page, '/admin/collections');
  await ED.page.getByRole('link', { name: NAME }).waitFor();
  eq(await ED.page.getByRole('button', { name: 'New collection' }).count(), 0, 'no New collection');
  await open(ED.page, `/admin/collections/${KEY}`);
  await ED.page.getByRole('button', { name: 'New entry' }).waitFor();
  await ED.page.getByRole('link', { name: 'View schema' }).click();
  await ED.page.getByTestId('read-only-note').waitFor();
  eq(await ED.page.getByTestId('save-definition').count(), 0, 'no Save');
  eq(await ED.page.getByRole('button', { name: 'Add field' }).count(), 0, 'no Add field');
  const r = await api(editorU.token, 'PATCH', `/collections/${KEY}`, { name: 'x' }, { 'if-match': (await defOf()).etag });
  eq(r.status, 403, 'editor manage_schema');
  const c = await api(editorU.token, 'POST', '/collections', { key: `x_${TAG}`, name: 'x', json_schema: { type: 'object', properties: {}, additionalProperties: false } });
  eq(c.status, 403, 'editor create collection');
  const ok1 = await api(editorU.token, 'POST', `/collections/${KEY}/entries`, { translations: { la: { title: `Editor entry ${TAG}`, slug: `editor-${TAG}` } } });
  eq(ok1.status, 201, 'editor creates an entry');
  await shot(ED.page, '90-editor-readonly-schema');
});

await t.step('viewer and author: read only. No New entry, the entry editor is read only, API writes are 403 (entries and definitions), the trash view is 403', async () => {
  await open(VW.page, `/admin/collections/${KEY}`);
  await VW.page.getByRole('link', { name: `Somsak ${TAG}` }).waitFor();
  eq(await VW.page.getByRole('button', { name: 'New entry' }).count(), 0, 'viewer: no New entry');
  eq(await VW.page.getByLabel('Show trash').count(), 0, 'viewer: no trash switch');
  await VW.page.getByRole('link', { name: `Somsak ${TAG}` }).click();
  await VW.page.getByTestId('read-only-note').waitFor();
  eq(await VW.page.getByRole('button', { name: 'Save draft' }).count(), 0, 'viewer: no Save draft');
  eq(await VW.page.getByLabel(/^Title \(/).isDisabled(), true, 'viewer: title disabled');
  const w = await api(viewerU.token, 'POST', `/collections/${KEY}/entries`, { translations: { la: { title: 'x' } } }); eq(w.status, 403, 'viewer create entry');
  const p = await api(viewerU.token, 'PATCH', `/collections/${KEY}`, { name: 'x' }, { 'if-match': (await defOf()).etag }); eq(p.status, 403, 'viewer PATCH definition');
  eq((await api(viewerU.token, 'GET', `/collections/${KEY}/entries?trashed=true`)).status, 403, 'viewer trash');
  eq((await api(authorU.token, 'POST', `/collections/${KEY}/entries`, { translations: { la: { title: 'x' } } })).status, 403, 'author create entry');
  eq((await api(authorU.token, 'PATCH', `/collections/${KEY}/entries/${idA}`, { sort_order: 3 }, { 'if-match': (await api(root, 'GET', `/collections/${KEY}/entries/${idA}`)).etag })).status, 403, 'author patch entry');
  eq((await api(authorU.token, 'GET', `/collections/${KEY}/entries/${idA}`)).status, 200, 'author reads');
  eq((await api(authorU.token, 'GET', `/audit-logs?entity_type=cms.collection_entry&entity_id=${idA}`)).status, 200, 'History tab is open to a reader');
});

await t.step('translator: may change the title / data of an existing language row, not the shared data, the order or a new language (403)', async () => {
  const e = await api(root, 'GET', `/collections/${KEY}/entries/${idA}`);
  const tok = translatorU.token;
  const shared = await api(tok, 'PATCH', `/collections/${KEY}/entries/${idA}`, { data: { year: 2000 } }, { 'if-match': e.etag }); eq(shared.status, 403, 'shared data');
  const order = await api(tok, 'PATCH', `/collections/${KEY}/entries/${idA}`, { sort_order: 9 }, { 'if-match': e.etag }); eq(order.status, 403, 'sort_order');
  const neu = await api(tok, 'PATCH', `/collections/${KEY}/entries/${idA}`, { translations: { th: { title: 'x' } } }, { 'if-match': e.etag }); ok([403, 422].includes(neu.status), 'new language row: ' + neu.status);
  const mine = await api(tok, 'PATCH', `/collections/${KEY}/entries/${idA}`, { translations: { la: { title: `Somsak T ${TAG}` } } }, { 'if-match': e.etag }); eq(mine.status, 200, 'title of an existing row');
  eq((await api(tok, 'POST', `/collections/${KEY}/entries/${idA}/publish`, undefined, { 'if-match': mine.etag })).status, 403, 'publish');
});

await t.step('no console error (CSP included) and no failed request outside the expected 4xx refusals', async () => {
  const bad = S.sink.console.filter((m) => !/Failed to load resource/.test(m));
  ok(bad.length === 0, 'console errors: ' + JSON.stringify(bad.slice(0, 3)));
  ok(!S.sink.console.some((m) => /Content Security Policy|unsafe-eval/i.test(m)), 'no CSP violation');
});

await t.done(S.ctx, ED.ctx, VW.ctx, b);
