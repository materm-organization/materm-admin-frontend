// Shared sections (SCR-22 list + editor, the shared parts of SCR-20) against the real backend. Written against doc/05 section 18 BEFORE the backend
// module exists: it needs the 14 routes of 18.0 and the changed rules of 18.9 / 18.11. Not run yet (the stack uses the backend working tree).
//
// Flow: create a shared section (draft) through the UI, fill and save it, place it in two pages from the "Shared" tab of the picker, the page publish is
// blocked while the shared section is a draft (blocker with an "Open shared section" link and Go to field), publish the shared section, then both pages
// publish; edit the source and publish it (the confirmation lists the 2 live pages, the list says "2 pages"); unpublish (confirmation with the pages,
// warning kept as a notice, the next page publish is blocked); delete is disabled while used and a 409 with references through the API; detach in
// both pages, publish them, then delete, trash and restore; the rules of 18.9 through the API; editor / viewer / author / translator rights; IDOR.
import { launch, suite, ok, eq, session, open, api, rootToken, newUser, TAG, shot } from '../lib.mjs';

const t = suite('95 shared sections');
const root = await rootToken();
const editorU = await newUser(root, 'editor');
const viewerU = await newUser(root, 'viewer');
const authorU = await newUser(root, 'author');
const translatorU = await newUser(root, 'translator');
const b = await launch();
const S = await session(b, { viewport: { width: 1440, height: 1300 } });
const ED = await session(b, { user: editorU.username, pass: editorU.password });
const VW = await session(b, { user: viewerU.username, pass: viewerU.password });
t.page = S.page;
const page = S.page;
const NAME = `E2E shared ${TAG}`;
const TITLE_V1 = `E2E_SHARED_V1_${TAG}`;
const TITLE_V2 = `E2E_SHARED_V2_${TAG}`;
const toast = (pg, re) => pg.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 10000 });
const etagOf = async (path) => (await api(root, 'GET', path)).etag;
const gotoShared = (pg = page) => open(pg, `/admin/sections/${sid}`);
let sid; let pA; let pB; let secA; let secB;

// A page the publish engine accepts: a hero with a Lao title and an image with alt text, and a Lao SEO title. Built through the API (the UI path is spec 30).
const mediaId = (await api(root, 'GET', '/media/assets?limit=24')).body.data.find((m) => m.kind !== 'brand')?.id;
async function newPage(label) {
  const c = await api(root, 'POST', '/pages', { template: 'standard', path: `/e2e-sh-${label}-${TAG}`, translations: { la: { title: `E2E shared page ${label} ${TAG}` } } });
  eq(c.status, 201, 'create page ' + label);
  const id = c.body.data.id;
  const hero = (await api(root, 'GET', `/pages/${id}/sections?include=props`)).body.data[0];
  const h = await api(root, 'PATCH', `/pages/${id}/sections/${hero.id}`, { props: { title: { la: `Hero ${label} ${TAG}` }, background: { media_id: mediaId, alt: { la: 'E2E alt' } } } }, { 'if-match': await etagOf(`/pages/${id}`) });
  eq(h.status, 200, 'hero ' + label);
  const s = await api(root, 'PATCH', `/pages/${id}`, { translations: { la: { seo_title: `SEO ${label} ${TAG}` } } }, { 'if-match': await etagOf(`/pages/${id}`) });
  eq(s.status, 200, 'seo ' + label);
  return id;
}
const sectionOf = async (pageId, sharedId) => (await api(root, 'GET', `/pages/${pageId}/sections`)).body.data.find((s) => s.shared_section_id === sharedId);
const addShared = async (pg, pageId) => {
  await open(pg, `/admin/pages/${pageId}`);
  await pg.getByRole('button', { name: 'Add section' }).click();
  const d = pg.getByRole('dialog', { name: 'Add a section' });
  await d.getByRole('tab', { name: 'Shared' }).click();
  await d.getByTestId(`shared-option-${sid}`).click();
  await toast(pg, /The section was added/);
};

await t.step('Content group lists Shared sections; New shared section creates a draft of the chosen kind and opens its editor (201 + ETag "1")', async () => {
  await open(page, '/admin');
  await page.getByRole('button', { name: 'Content' }).click();
  await page.getByRole('link', { name: 'Shared sections' }).click();
  await page.waitForURL(/\/admin\/sections$/);
  await page.getByRole('heading', { name: 'Shared sections' }).first().waitFor();
  await page.getByRole('button', { name: 'New shared section' }).click();
  const d = page.getByRole('dialog', { name: 'New shared section' });
  await d.getByRole('button', { name: 'Create' }).click();
  await d.getByText('The name is required.').waitFor();
  await d.getByLabel('Name').fill(NAME);
  await d.getByRole('radio', { name: /Intro heading/ }).click();
  const w = page.waitForResponse((r) => r.url().endsWith('/shared-sections') && r.request().method() === 'POST');
  await d.getByRole('button', { name: 'Create' }).click();
  const res = await w; eq(res.status(), 201, 'create status'); eq(res.headers()['etag'], '"1"', 'ETag header');
  ok(res.headers()['location']?.includes('/shared-sections/'), 'Location');
  await page.waitForURL(/\/admin\/sections\/\d+/);
  sid = Number(new URL(page.url()).pathname.split('/').pop()); ok(sid > 0, 'id');
  await page.getByTestId('shared-type-line').waitFor();
  const got = (await api(root, 'GET', `/shared-sections/${sid}`)).body.data;
  eq(got.status, 'draft', 'draft'); eq(got.name, NAME, 'name'); eq(got.section_type.key, 'intro_heading', 'type'); eq(got.used_in_pages, 0, 'unused');
  ok(/Intro heading · version 1/.test(await page.getByTestId('shared-type-line').innerText()), 'type and version are shown, read only');
  eq(await page.getByRole('button', { name: 'Preview' }).count(), 0, 'no Preview button (SS-10)');
});

await t.step('fill the section through the same schema form as SCR-21 and Save section: one PATCH with the shared ETag; the page ETag is not used', async () => {
  await page.locator('[id$="_eyebrow_la"]').first().fill('E2E eyebrow');
  await page.locator('[id$="_title_la"]').first().fill(TITLE_V1);
  const seen = []; page.on('request', (r) => { if (r.method() === 'PATCH') seen.push({ url: r.url(), ifMatch: r.headers()['if-match'] }); });
  const w = page.waitForResponse((r) => r.url().endsWith(`/shared-sections/${sid}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save section' }).click();
  const res = await w; eq(res.status(), 200, 'PATCH status'); eq(res.headers()['etag'], '"2"', 'ETag moved once');
  eq(seen.length, 1, 'one PATCH'); eq(seen[0].ifMatch, '"1"', 'If-Match is the shared section ETag');
  eq((await api(root, 'GET', `/shared-sections/${sid}`)).body.data.props.title.la, TITLE_V1, 'stored');
});

await t.step('rename inline (PATCH name) and the History tab lists cms.shared_section rows with the numeric id', async () => {
  await page.getByLabel('Name').fill(NAME + ' ');
  const w = page.waitForResponse((r) => r.url().endsWith(`/shared-sections/${sid}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Rename' }).click();
  eq((await w).status(), 200, 'rename');
  eq((await api(root, 'GET', `/shared-sections/${sid}`)).body.data.name, NAME, 'trimmed on the server');
  await page.getByRole('tab', { name: 'Activity' }).click();
  await page.getByText(/cms\.shared_section\./).first().waitFor({ timeout: 10000 });
  await page.getByRole('tab', { name: 'Content' }).click();
});

await t.step('place it in two pages from the Shared tab of the picker (a draft one is offered with a hint and a warning toast); the section list shows the Shared badge and "Not published"', async () => {
  pA = await newPage('a'); pB = await newPage('b');
  await open(page, `/admin/pages/${pA}`);
  await page.getByRole('button', { name: 'Add section' }).click();
  const d = page.getByRole('dialog', { name: 'Add a section' });
  await d.getByRole('tab', { name: 'Shared' }).click();
  await d.getByTestId(`shared-option-${sid}`).waitFor();
  ok(/Not published yet/.test(await d.getByTestId(`shared-option-${sid}`).innerText()), 'hint on the card');
  const w = page.waitForResponse((r) => r.url().endsWith(`/pages/${pA}/sections`) && r.request().method() === 'POST');
  await d.getByTestId(`shared-option-${sid}`).click();
  const res = await w; eq(res.status(), 201, 'POST status');
  const sent = JSON.parse(res.request().postData() || '{}'); eq(sent.shared_section_id, sid, 'sends shared_section_id'); ok(!('variant' in sent) && !('props' in sent) && !('section_type_key' in sent), 'no variant / props / type: ' + res.request().postData());
  const body = await res.json(); ok(body.data.warnings.some((x) => x.code === 'shared_section_not_live' && x.params.shared_state === 'draft'), 'warning shared_section_not_live');
  await toast(page, /not published yet/);
  const row = page.getByTestId('shared-badge').first(); await row.waitFor();
  await page.getByTestId('shared-state-badge').first().waitFor();
  secA = await sectionOf(pA, sid); ok(secA, 'section A'); eq(Object.keys(secA.props).length, 0, 'props {}'); eq(secA.variant, null, 'variant null');
  await addShared(page, pB);
  secB = await sectionOf(pB, sid); ok(secB, 'section B');
  eq((await api(root, 'GET', `/shared-sections/${sid}`)).body.data.used_in_pages, 2, 'used in 2 pages');
});

await t.step('the page publish is blocked while the shared section is a draft: the blocker says so, links to the shared section, and Go to field selects the section', async () => {
  await open(page, `/admin/pages/${pA}`);
  await page.getByRole('button', { name: /^Publish$/ }).click();
  const d = page.getByTestId('publish-blockers'); await d.waitFor({ timeout: 10000 });
  ok(/shared section is not published yet/i.test(await d.innerText()), 'blocker text: ' + (await d.innerText()).slice(0, 200));
  eq(await d.getByTestId('open-shared-link').getAttribute('href'), `/admin/sections/${sid}`, 'Open shared section link');
  const dry = await api(root, 'POST', `/pages/${pA}/publish?dry_run=true`, undefined, { 'if-match': await etagOf(`/pages/${pA}`) });
  eq(dry.status, 422, 'API'); eq(dry.body.code, 'PUBLISH_BLOCKED', 'code');
  const e = dry.body.errors.find((x) => x.code === 'reference_not_published');
  ok(e && e.path === `/sections/${secA.public_id}/shared_section_id` && e.params.ref_type === 'cms_shared_sections' && e.params.ref_id === sid && e.params.shared_state === 'draft', 'blocker shape: ' + JSON.stringify(dry.body.errors));
  await d.getByRole('button', { name: /^Go to field/ }).first().click();
  await page.getByTestId('shared-reference-panel').waitFor({ timeout: 10000 });
  ok(page.url().includes(`section=${secA.id}`), 'section selected: ' + page.url());
  ok(await page.getByTestId('shared-not-live-alert').isVisible(), 'the panel says it is not published');
  eq(await page.getByTestId('edit-source-link').getAttribute('target'), '_blank', 'Edit source opens a new tab');
  await shot(page, '95-page-blocked');
});

await t.step('publish the shared section (the confirmation says no live page shows it yet); then both pages publish', async () => {
  await gotoShared();
  await page.getByRole('button', { name: /^Publish$/ }).click();
  const d = page.getByTestId('publish-confirm'); await d.waitFor();
  await d.getByTestId('publish-shared-extra').waitFor({ timeout: 10000 });
  ok(/No live page shows it yet/.test(await d.getByTestId('publish-shared-extra').innerText()), 'no live page yet');
  const w = page.waitForResponse((r) => r.url().endsWith(`/shared-sections/${sid}/publish`) && !r.url().includes('dry_run') && r.request().method() === 'POST');
  await d.getByRole('button', { name: /^Publish/ }).last().click();
  eq((await w).status(), 200, 'publish');
  await toast(page, /published/i);
  const got = (await api(root, 'GET', `/shared-sections/${sid}`)).body.data; eq(got.status, 'published', 'published'); eq(got.has_unpublished_changes, false, 'no draft');
  for (const [id, label] of [[pA, 'a'], [pB, 'b']]) {
    const r = await api(root, 'POST', `/pages/${id}/publish`, undefined, { 'if-match': await etagOf(`/pages/${id}`) });
    eq(r.status, 200, 'publish page ' + label + ': ' + JSON.stringify(r.body?.errors));
  }
  await open(page, `/admin/pages/${pA}?section=${secA.id}`);
  await page.getByTestId('shared-reference-panel').waitFor();
  eq(await page.getByTestId('shared-not-live-alert').count(), 0, 'no warning any more');
  ok(await page.getByTestId('shared-readonly-note').waitFor({ timeout: 10000 }).then(() => true), 'read-only view of the source');
});

await t.step('edit the source and publish it: the confirmation lists the 2 live pages; the list says "Used in 2 pages" and its sheet names both', async () => {
  await gotoShared();
  await page.locator('[id$="_title_la"]').first().fill(TITLE_V2);
  await page.getByRole('button', { name: 'Save section' }).click();
  await page.waitForResponse((r) => r.url().endsWith(`/shared-sections/${sid}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: /^Publish changes$/ }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^Publish changes$/ }).click();
  const d = page.getByTestId('publish-confirm'); await d.waitFor();
  await d.getByTestId('publish-shared-pages').waitFor({ timeout: 10000 });
  ok(/The change goes live on 2 pages/.test(await d.getByTestId('publish-shared-extra').innerText()), await d.getByTestId('publish-shared-extra').innerText());
  eq(await d.getByTestId('publish-shared-pages').locator('li').count(), 2, 'both pages listed');
  await d.getByRole('button', { name: /^Publish/ }).last().click();
  await toast(page, /published/i);
  await open(page, '/admin/sections');
  const used = page.getByTestId(`used-in-${sid}`); await used.waitFor();
  ok(/2 pages/.test(await used.innerText()), 'list: ' + (await used.innerText()));
  await used.click();
  const sheet = page.getByTestId('usages-sheet'); await sheet.getByTestId(`usage-page-${pA}`).waitFor({ timeout: 10000 });
  await sheet.getByTestId(`usage-page-${pB}`).waitFor();
  eq(await sheet.getByTestId('live-on-site').count(), 2, 'both live on the website');
  const u = (await api(root, 'GET', `/shared-sections/${sid}/usages`)).body.data;
  eq(u.total_pages, 2, 'usages total'); ok(u.pages.every((p) => p.live_on_site), 'live_on_site');
  await shot(page, '95-usages');
  await page.keyboard.press('Escape');
});

await t.step('unpublish: the confirmation lists the 2 live pages that lose the section and can always be confirmed; the answer warns shared_section_referenced; the next page publish is blocked', async () => {
  await gotoShared();
  await page.getByRole('button', { name: /^Unpublish$/ }).click();
  const d = page.getByRole('alertdialog'); const extra = d.getByTestId('unpublish-shared-extra'); await extra.waitFor({ timeout: 10000 });
  ok(/2 live pages lose this section/.test(await extra.innerText()), await extra.innerText());
  eq(await d.getByTestId('unpublish-shared-pages').locator('li').count(), 2, 'pages listed');
  const w = page.waitForResponse((r) => r.url().endsWith(`/shared-sections/${sid}/unpublish`) && r.request().method() === 'POST');
  await d.getByRole('button', { name: /^Unpublish$/ }).click();
  const res = await w; eq(res.status(), 200, 'unpublish always works');
  const warn = (await res.json()).data.warnings.find((x) => x.code === 'shared_section_referenced');
  ok(warn && warn.params.live_pages_total === 2 && warn.params.pages_blocked_on_publish >= 2, 'warning: ' + JSON.stringify(warn));
  await page.getByTestId('notice-shared_section_referenced').waitFor({ timeout: 10000 });
  // a page change is now blocked at the next publish (SS-2) until the shared section is published again
  const hide = await api(root, 'PATCH', `/pages/${pA}/sections/${secA.id}`, { anchor_id: `a${TAG}` }, { 'if-match': await etagOf(`/pages/${pA}`) });
  eq(hide.status, 200, 'page edit');
  const dry = await api(root, 'POST', `/pages/${pA}/publish?dry_run=true`, undefined, { 'if-match': await etagOf(`/pages/${pA}`) });
  eq(dry.status, 422, 'blocked'); ok(dry.body.errors.some((x) => x.code === 'reference_not_published' && x.params.shared_state === 'archived'), 'archived: ' + JSON.stringify(dry.body.errors));
  // the unpublish also hides the section for a hidden reference: a hidden section is skipped (PG-7)
  const hidden = await api(root, 'PATCH', `/pages/${pA}/sections/${secA.id}`, { is_visible: false }, { 'if-match': await etagOf(`/pages/${pA}`) });
  eq(hidden.status, 200, 'hide');
  const ok2 = await api(root, 'POST', `/pages/${pA}/publish?dry_run=true`, undefined, { 'if-match': await etagOf(`/pages/${pA}`) });
  eq(ok2.status, 200, 'a hidden reference does not block'); ok(ok2.body.data.warnings.some((x) => x.code === 'section_hidden_unchecked'), 'section_hidden_unchecked');
  const show = await api(root, 'PATCH', `/pages/${pA}/sections/${secA.id}`, { is_visible: true }, { 'if-match': await etagOf(`/pages/${pA}`) });
  eq(show.status, 200, 'show again');
  ok(show.body.data.warnings.some((x) => x.code === 'shared_section_not_live'), 'showing it again warns shared_section_not_live');
});

await t.step('delete is disabled with the reason while pages use it; the API answers 409 ENTITY_REFERENCED shared_section_in_use with rows (section_ref + draft_section_ref)', async () => {
  await gotoShared();
  eq(await page.getByTestId('delete-button').isDisabled(), true, 'disabled');
  ok(/Detach or delete the section in those pages first/.test(await page.getByTestId('delete-reason').innerText()), 'reason');
  await shot(page, '95-delete-disabled');
  const r = await api(root, 'DELETE', `/shared-sections/${sid}`, undefined, { 'if-match': await etagOf(`/shared-sections/${sid}`) });
  eq(r.status, 409, 'status'); eq(r.body.code, 'ENTITY_REFERENCED', 'code'); eq(r.body.details.reason, 'shared_section_in_use', 'reason');
  ok(r.body.details.references.length >= 2 && r.body.details.total_references >= 2, 'rows');
  const row = r.body.details.references.find((x) => x.id === pA);
  ok(row && row.entity_type === 'cms.page' && row.section_id === secA.id && ['section_ref', 'draft_section_ref'].includes(row.kind) && 'in_draft' in row && 'page_status' in row && 'page_trashed' in row && 'is_visible' in row, 'row shape: ' + JSON.stringify(r.body.details.references[0]));
  eq((await api(root, 'GET', `/shared-sections/${sid}`)).body.data.deleted_at, null, 'nothing was deleted');
  const list = (await api(root, 'GET', `/shared-sections?in_use=true&keyword=${encodeURIComponent(NAME)}`)).body.data;
  ok(list.some((x) => x.id === sid && x.used_in_pages === 2), 'list counts used_in_pages = 2: ' + JSON.stringify(list.map((x) => [x.id, x.used_in_pages])));
});

await t.step('API contract of the page side: variant / props / a wrong type key / a missing shared section on POST, props on PATCH, an immutable reference, a required slot', async () => {
  const withEtag = async (body) => api(root, 'POST', `/pages/${pB}/sections`, body, { 'if-match': await etagOf(`/pages/${pB}`) });
  const v = await withEtag({ shared_section_id: sid, variant: 'x' }); eq(v.status, 422, 'variant'); ok(v.body.errors.some((e) => e.path === '/variant' && e.code === 'not_applicable'), JSON.stringify(v.body.errors));
  const p = await withEtag({ shared_section_id: sid, props: { a: 1 } }); eq(p.status, 422, 'props'); ok(p.body.errors.some((e) => e.path === '/props' && e.code === 'not_applicable'), JSON.stringify(p.body.errors));
  const k = await withEtag({ shared_section_id: sid, section_type_key: 'faq' }); eq(k.status, 422, 'type key'); ok(k.body.errors.some((e) => e.path === '/section_type_key' && e.code === 'not_in_enum'), JSON.stringify(k.body.errors));
  const g = await withEtag({ shared_section_id: 99999999 }); eq(g.status, 422, 'unknown'); ok(g.body.errors.some((e) => e.path === '/shared_section_id' && e.code === 'unknown_reference' && e.params.ref_type === 'cms_shared_sections'), JSON.stringify(g.body.errors));
  const pr = await api(root, 'PATCH', `/pages/${pB}/sections/${secB.id}`, { props: { title: { la: 'x' } } }, { 'if-match': await etagOf(`/pages/${pB}`) });
  eq(pr.status, 422, 'PATCH props'); ok(pr.body.errors.some((e) => e.path === '/props' && e.code === 'not_applicable' && e.params.reason === 'shared_reference'), JSON.stringify(pr.body.errors));
  const im = await api(root, 'PATCH', `/pages/${pB}/sections/${secB.id}`, { shared_section_id: null }, { 'if-match': await etagOf(`/pages/${pB}`) });
  eq(im.status, 422, 'immutable'); ok(im.body.errors.some((e) => e.path === '/shared_section_id' && e.code === 'immutable'), JSON.stringify(im.body.errors));
  const hero = await api(root, 'POST', '/shared-sections', { name: `E2E hero ${TAG}`, section_type_key: 'hero_brand' });
  eq(hero.status, 201, 'a hero can be a shared section');
  const slot = await withEtag({ shared_section_id: hero.body.data.id }); eq(slot.status, 422, 'required slot');
  ok(slot.body.errors.some((e) => e.code === 'template_violation' && e.params.rule === 'shared_in_required_slot'), JSON.stringify(slot.body.errors));
  const placeable = (await api(root, 'GET', `/shared-sections?placeable_on_page=${pB}&limit=100`)).body.data.map((x) => x.id);
  ok(placeable.includes(sid) && !placeable.includes(hero.body.data.id), 'placeable_on_page keeps the intro heading and drops the hero');
  eq((await api(root, 'GET', '/shared-sections?placeable_on_page=99999999')).status, 422, 'placeable_on_page of an unknown page');
  const im2 = await api(root, 'PATCH', `/shared-sections/${sid}`, { section_type_key: 'faq' }, { 'if-match': await etagOf(`/shared-sections/${sid}`) });
  eq(im2.status, 422, 'type is immutable'); ok(im2.body.errors.some((e) => e.path === '/section_type_key' && e.code === 'immutable'), JSON.stringify(im2.body.errors));
});

await t.step('detach in page A through the UI (confirmation says the draft is copied): the section is the page own copy, the page is a draft; detach in page B through the API is idempotent the second time', async () => {
  await open(page, `/admin/pages/${pA}?section=${secA.id}`);
  await page.getByTestId('detach-button').click();
  const d = page.getByRole('alertdialog'); ok(/including its unpublished draft/.test(await d.innerText()), 'text');
  const w = page.waitForResponse((r) => r.url().endsWith(`/pages/${pA}/sections/${secA.id}/detach`) && r.request().method() === 'POST');
  await d.getByRole('button', { name: 'Detach' }).click();
  const res = await w; eq(res.status(), 200, 'detach'); ok(res.request().headers()['if-match']?.startsWith('"'), 'page If-Match');
  await toast(page, /belongs to this page only/);
  await page.getByTestId('section-editor').waitFor({ timeout: 10000 });
  const own = (await api(root, 'GET', `/pages/${pA}/sections?include=props`)).body.data.find((s) => s.id === secA.id);
  eq(own.shared_section_id, null, 'reference cleared'); eq(own.shared_section, null, 'no shared block');
  eq(own.props.title.la, TITLE_V2, 'the working copy of the shared section was copied');
  const first = await api(root, 'POST', `/pages/${pB}/sections/${secB.id}/detach`, undefined, { 'if-match': await etagOf(`/pages/${pB}`) });
  eq(first.status, 200, 'detach B'); ok(first.etag, 'new ETag');
  const again = await api(root, 'POST', `/pages/${pB}/sections/${secB.id}/detach`, undefined, { 'if-match': first.etag });
  eq(again.status, 200, 'idempotent'); eq(again.etag, first.etag, 'same ETag: nothing changed'); eq(again.body.data.warnings.length, 0, 'no warning');
  eq((await api(root, 'POST', `/pages/${pB}/sections/${secB.id}/detach`, undefined, {})).status, 428, 'If-Match is required');
});

await t.step('IDOR: a section of page A detached through page B is 404, an unknown shared section / usages is 404, ids are not guessable across pages', async () => {
  eq((await api(root, 'POST', `/pages/${pB}/sections/${secA.id}/detach`, undefined, { 'if-match': await etagOf(`/pages/${pB}`) })).status, 404, 'section of another page');
  eq((await api(root, 'GET', '/shared-sections/99999999')).status, 404, 'unknown shared section');
  eq((await api(root, 'GET', '/shared-sections/99999999/usages')).status, 404, 'unknown usages');
  eq((await api(root, 'GET', `/pages/${pB}/sections/${secA.id}`)).status, 404, 'GET through the wrong page');
  await open(page, '/admin/sections/99999999');
  await page.getByText('Shared section not found').waitFor({ timeout: 10000 });
});

await t.step('after both pages are published (their rows no longer name it) the shared section can be deleted; it goes to the trash, Restore brings it back as a draft', async () => {
  for (const id of [pA, pB]) {
    const r = await api(root, 'POST', `/pages/${id}/publish`, undefined, { 'if-match': await etagOf(`/pages/${id}`) });
    eq(r.status, 200, 'publish page after detach: ' + JSON.stringify(r.body?.errors));
  }
  await gotoShared();
  await page.getByTestId('delete-button').waitFor();
  eq(await page.getByTestId('delete-button').isDisabled(), false, 'enabled');
  await page.getByTestId('delete-button').click();
  const w = page.waitForResponse((r) => r.url().endsWith(`/shared-sections/${sid}`) && r.request().method() === 'DELETE');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  eq((await w).status(), 200, 'delete'); await page.waitForURL(/\/admin\/sections$/);
  ok((await api(root, 'GET', `/shared-sections/${sid}`)).body.data.deleted_at, 'in the trash');
  await open(page, '/admin/sections?trashed=true');
  await page.getByRole('button', { name: new RegExp('^Restore ' + NAME) }).click();
  await toast(page, /restored as a draft/);
  eq((await api(root, 'GET', `/shared-sections/${sid}`)).body.data.status, 'draft', 'back as a draft');
});

await t.step('editor: create / delete through the API and New shared section in the UI; viewer / author: read only (UI and API); the page side shows no Detach to a reader', async () => {
  const c = await api(editorU.token, 'POST', '/shared-sections', { name: `E2E editor ${TAG}`, section_type_key: 'intro_heading' });
  eq(c.status, 201, 'editor creates'); const eid = c.body.data.id;
  await open(ED.page, '/admin/sections');
  await ED.page.getByRole('button', { name: 'New shared section' }).waitFor();
  eq((await api(editorU.token, 'DELETE', `/shared-sections/${eid}`, undefined, { 'if-match': c.etag })).status, 200, 'editor deletes');
  // a reader
  const placed = await api(root, 'POST', `/pages/${pB}/sections`, { shared_section_id: sid }, { 'if-match': await etagOf(`/pages/${pB}`) });
  eq(placed.status, 201, 'place again for the reader view');
  await open(VW.page, '/admin/sections');
  await VW.page.getByRole('link', { name: NAME }).waitFor();
  eq(await VW.page.getByRole('button', { name: 'New shared section' }).count(), 0, 'viewer: no New');
  eq(await VW.page.getByLabel('Trash').count(), 0, 'viewer: no trash switch');
  await VW.page.getByRole('link', { name: NAME }).click();
  await VW.page.getByTestId('shared-type-line').waitFor();
  eq(await VW.page.getByRole('button', { name: 'Rename' }).count(), 0, 'viewer: no Rename');
  eq(await VW.page.getByTestId('delete-button').count(), 0, 'viewer: no Delete');
  eq(await VW.page.getByRole('button', { name: /^Publish/ }).count(), 0, 'viewer: no Publish');
  await open(VW.page, `/admin/pages/${pB}?section=${placed.body.data.section.id}`);
  await VW.page.getByTestId('shared-reference-panel').waitFor({ timeout: 10000 });
  eq(await VW.page.getByTestId('detach-button').count(), 0, 'viewer: no Detach');
  await shot(VW.page, '95-viewer-panel');
  const e = await etagOf(`/shared-sections/${sid}`);
  const deny = async (label, r) => { eq(r.status, 403, label); };
  await deny('viewer create', await api(viewerU.token, 'POST', '/shared-sections', { name: 'x', section_type_key: 'intro_heading' }));
  await deny('viewer patch', await api(viewerU.token, 'PATCH', `/shared-sections/${sid}`, { name: 'x' }, { 'if-match': e }));
  await deny('viewer delete', await api(viewerU.token, 'DELETE', `/shared-sections/${sid}`, undefined, { 'if-match': e }));
  await deny('viewer publish', await api(viewerU.token, 'POST', `/shared-sections/${sid}/publish`, undefined, { 'if-match': e }));
  await deny('viewer trash list', await api(viewerU.token, 'GET', '/shared-sections?trashed=true'));
  await deny('author create', await api(authorU.token, 'POST', '/shared-sections', { name: 'x', section_type_key: 'intro_heading' }));
  await deny('author patch', await api(authorU.token, 'PATCH', `/shared-sections/${sid}`, { name: 'x' }, { 'if-match': e }));
  eq((await api(authorU.token, 'GET', `/shared-sections/${sid}`)).status, 200, 'author reads');
  eq((await api(authorU.token, 'GET', `/shared-sections/${sid}/usages`)).status, 200, 'author reads usages');
  eq((await api(authorU.token, 'GET', `/audit-logs?entity_type=cms.shared_section&entity_id=${sid}`)).status, 200, 'the History tab is open to a reader');
  await deny('viewer detach', await api(viewerU.token, 'POST', `/pages/${pB}/sections/${placed.body.data.section.id}/detach`, undefined, { 'if-match': await etagOf(`/pages/${pB}`) }));
});

await t.step('translator: changes text under x-localized only; name, creation, deletion, publish and the visibility of a reference are 403', async () => {
  const tok = translatorU.token;
  const cur = await api(root, 'GET', `/shared-sections/${sid}`);
  const text = await api(tok, 'PATCH', `/shared-sections/${sid}`, { props: { ...cur.body.data.props, title: { ...cur.body.data.props.title, la: TITLE_V2 + ' T' } } }, { 'if-match': cur.etag });
  eq(text.status, 200, 'localized text: ' + JSON.stringify(text.body?.errors));
  eq((await api(tok, 'PATCH', `/shared-sections/${sid}`, { name: 'renamed' }, { 'if-match': text.etag })).status, 403, 'name');
  eq((await api(tok, 'POST', '/shared-sections', { name: 'x', section_type_key: 'intro_heading' })).status, 403, 'create');
  eq((await api(tok, 'DELETE', `/shared-sections/${sid}`, undefined, { 'if-match': text.etag })).status, 403, 'delete');
  eq((await api(tok, 'POST', `/shared-sections/${sid}/publish`, undefined, { 'if-match': text.etag })).status, 403, 'publish');
  const ref = (await api(root, 'GET', `/pages/${pB}/sections`)).body.data.find((s) => s.shared_section_id === sid);
  eq((await api(tok, 'PATCH', `/pages/${pB}/sections/${ref.id}`, { is_visible: false }, { 'if-match': await etagOf(`/pages/${pB}`) })).status, 403, 'visibility of a reference');
  eq((await api(tok, 'POST', `/pages/${pB}/sections/${ref.id}/detach`, undefined, { 'if-match': await etagOf(`/pages/${pB}`) })).status, 403, 'detach');
});

await t.step('a delete the screen did not expect (it became used after the editor loaded): the 409 is shown as a dialog that lists the pages, a page in the trash with its hint', async () => {
  const c = await api(root, 'POST', '/shared-sections', { name: `E2E stale ${TAG}`, section_type_key: 'intro_heading' });
  eq(c.status, 201, 'create'); const xid = c.body.data.id;
  await open(page, `/admin/sections/${xid}`);
  await page.getByTestId('delete-button').waitFor();
  eq(await page.getByTestId('delete-button').isDisabled(), false, 'enabled: the screen thinks it is unused');
  const placed = await api(root, 'POST', `/pages/${pB}/sections`, { shared_section_id: xid }, { 'if-match': await etagOf(`/pages/${pB}`) });
  eq(placed.status, 201, 'used now');
  await page.getByTestId('delete-button').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  const d = page.getByTestId('delete-blocked'); await d.waitFor({ timeout: 10000 });
  ok(await d.getByTestId('reference-row').count() >= 1, 'rows listed');
  await shot(page, '95-delete-409');
  const out = await api(root, 'DELETE', `/shared-sections/${xid}`, undefined, { 'if-match': await etagOf(`/shared-sections/${xid}`) });
  eq(out.status, 409, 'still referenced');
  const rm = await api(root, 'DELETE', `/pages/${pB}/sections/${placed.body.data.section.id}`, undefined, { 'if-match': await etagOf(`/pages/${pB}`) });
  eq(rm.status, 200, 'removing the reference deletes only the reference');
  eq((await api(root, 'GET', `/shared-sections/${xid}`)).status, 200, 'the shared section is untouched');
});

await t.step('no console error (CSP included): the production CSP stays strict, the shared form uses the precompiled validators', async () => {
  const bad = S.sink.console.filter((m) => !/Failed to load resource/.test(m));
  ok(bad.length === 0, 'console errors: ' + JSON.stringify(bad.slice(0, 3)));
  ok(!S.sink.console.some((m) => /Content Security Policy|unsafe-eval/i.test(m)), 'no CSP violation');
  ok(!ED.sink.console.some((m) => /Content Security Policy|unsafe-eval/i.test(m)), 'no CSP violation (editor)');
});

await t.done(S.ctx, ED.ctx, VW.ctx, b);
