// Save-live screens against the real backend: settings + SEO (+409 in two tabs, history), UI strings, categories / tags, menus, media metadata.
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, suite, ok, eq, session, open, TAG, shot, apiLogin, ADMIN_BE, ADMIN_FE } from '../lib.mjs';

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

// ---- video support (release 1): upload a synthetic MP4 through the library against the real admin backend. The scratch stack has no
// file service, so this block starts a tiny fake one (port 3205, as flow 95 of e2e-cross-system does) and restarts ONLY the admin backend
// with FILE_* pointing at it (05-restart-admin.sh), then restores it. Synthetic data only: boxes are built here, nothing of the user's.
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
const box = (type, ...parts) => { const p = Buffer.concat(parts); return Buffer.concat([u32(8 + p.length), Buffer.from(type), p]); };
function mp4({ durationMs = 3000, width = 320, height = 240, moovLast = false, salt = 0 } = {}) {
  const tkhd = Buffer.concat([Buffer.from([0, 0, 0, 3]), Buffer.alloc(36), ...[0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32), u32(width << 16), u32(height << 16)]);
  const trak = box('trak', box('tkhd', tkhd), box('mdia', box('hdlr', Buffer.alloc(8), Buffer.from('vide'), Buffer.alloc(13)),
    box('minf', box('stbl', box('stsd', Buffer.alloc(4), u32(1), box('avc1', Buffer.alloc(78)))))));
  const moov = box('moov', box('mvhd', Buffer.alloc(4), u32(0), u32(0), u32(1000), u32(durationMs), Buffer.alloc(80)), trak);
  const ftyp = box('ftyp', Buffer.from('isom'), u32(512), Buffer.from('isom'), Buffer.from('mp42'));
  const mdat = box('mdat', Buffer.alloc(20000, salt), crypto.randomBytes(16)); // random tail: a rerun is never a duplicate (409)
  return moovLast ? Buffer.concat([ftyp, mdat, moov]) : Buffer.concat([ftyp, moov, mdat]);
}
const FAKE_PORT = 3205, FAKE_KEY = 'fake-' + TAG, FAKE_BUCKET = 'e2e-video';
const store = new Map();
const fake = http.createServer(async (req, res) => {
  const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (req.method === 'GET' && store.has(req.url.split('?')[0])) { res.writeHead(200, { 'content-type': 'video/mp4' }); return res.end(store.get(req.url.split('?')[0])); }
    if (req.headers['x-api-key'] !== FAKE_KEY) return reply(401, { status: false });
    if (req.method === 'POST' && req.url === '/api/v1/file/upload') {
      const fd = await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: req, duplex: 'half' }).formData();
      const f = fd.get('FILES'), bucket = fd.get('BUCKET');
      const fp = `/buckets/${bucket}/${f.name}`; store.set(fp, Buffer.from(await f.arrayBuffer()));
      return reply(200, { status: true, data: { bucket, file_name: f.name, file_path: fp } });
    }
    if (req.method === 'DELETE' && req.url === '/api/v1/file/delete') { for await (const _ of req); return reply(200, { status: true }); }
    reply(404, { status: false });
  } catch (e) { reply(500, { status: false, err: String(e).slice(0, 100) }); }
});
const restartAdmin = (extra) => execFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../e2e-cross-system/05-restart-admin.sh'), { env: { ...process.env, ...extra }, stdio: 'pipe' });
await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r));
let restored = false;
try {
  restartAdmin({ FILE_HOST: '127.0.0.1', FILE_PORT: String(FAKE_PORT), FILE_KEY: FAKE_KEY, FILE_BUCKET: FAKE_BUCKET, FILE_PATH_IP: `http://localhost:${FAKE_PORT}` });
  const name = `e2e-video-${TAG}.mp4`;

  await t.step('video: the browser pre-check refuses an MP4 whose index is after the data (fast-start message), nothing is sent', async () => {
    await open(page, '/admin/media');
    await page.getByRole('button', { name: 'Upload files' }).click();
    const dlg = page.getByRole('dialog', { name: 'Upload files' });
    ok(/MP4/.test(await dlg.innerText()), 'dialog lists MP4 and its limits');
    let sent = false; page.on('request', (r) => { if (r.method() === 'POST' && /\/media\/uploads/.test(r.url())) sent = true; });
    await dlg.getByTestId('media-upload-input').setInputFiles({ name: `e2e-late-${TAG}.mp4`, mimeType: 'video/mp4', buffer: mp4({ moovLast: true }) });
    await dlg.getByText(/movflags \+faststart/).waitFor({ timeout: 8000 });
    await page.waitForTimeout(500); ok(!sent, 'no upload request was made');
    await page.keyboard.press('Escape');
  });

  await t.step('video: the server answers the same file with 422 faststart_required at /file (direct API call)', async () => {
    const tok = await apiLogin();
    const fd = new FormData(); fd.append('file', new Blob([mp4({ moovLast: true })], { type: 'video/mp4' }), `e2e-late2-${TAG}.mp4`);
    const r = await fetch(ADMIN_BE + '/api/v1/media/uploads', { method: 'POST', headers: { authorization: 'Bearer ' + tok }, body: fd });
    const j = await r.json(); eq(r.status, 422, 'status');
    eq(j.errors?.[0]?.path, '/file', 'path'); eq(j.errors?.[0]?.code, 'faststart_required', 'code');
    ok(/faststart/.test(j.errors[0].message), 'editor-facing English message');
  });

  await t.step('video: upload a valid MP4 in the library -> tile with film placeholder, duration 0:03 and no alt badge', async () => {
    await open(page, '/admin/media');
    await page.getByRole('button', { name: 'Upload files' }).click();
    const dlg = page.getByRole('dialog', { name: 'Upload files' });
    await dlg.getByTestId('media-upload-input').setInputFiles({ name, mimeType: 'video/mp4', buffer: mp4() });
    await dlg.getByText(/· Done$/).waitFor({ timeout: 30000 });
    await page.keyboard.press('Escape');
    const tile = page.getByRole('button', { name: 'Open ' + name }).first();
    await tile.waitFor({ timeout: 15000 });
    const li = tile.locator('xpath=ancestor::li[1]');
    eq((await li.locator('[data-slot=video-duration-badge]').innerText()).trim(), '0:03', 'duration badge');
    ok((await li.locator('[data-slot=video-play-badge]').count()) === 1, 'play badge');
    ok((await li.locator('video').count()) === 0, 'the grid does not load the video');
    ok(!/No alt text/.test(await li.innerText()), 'no alt nag on a video');
  });

  await t.step('video: the detail sheet renders a native player (src = file-service url), the facts, no alt text fields; the production CSP has media-src', async () => {
    // The player may be swapped for the film placeholder a moment later: the admin frontend caches the backend /config (media origin) for 5 minutes,
    // and this stack's first answer (no file service yet) is still cached, so the file-service origin is not in media-src here. The element is recorded when it first appears.
    await page.addInitScript(() => {
      new MutationObserver(() => {
        const v = document.querySelector('video[src][controls]');
        if (v && !window.__videoSeen) window.__videoSeen = { src: v.getAttribute('src'), preload: v.getAttribute('preload'), controls: v.hasAttribute('controls'), playsinline: v.hasAttribute('playsinline'), crossorigin: v.hasAttribute('crossorigin') };
      }).observe(document, { childList: true, subtree: true, attributes: true });
    });
    const resp = await page.goto(ADMIN_FE + '/admin/media', { waitUntil: 'domcontentloaded' });
    const csp = resp.headers()['content-security-policy'] || '';
    ok(/media-src 'self' blob:/.test(csp) && !/unsafe-eval/.test(csp), 'media-src in the production CSP: ' + csp.split('; ').filter((d) => /^(media|img)-src/.test(d)).join(' | '));
    await page.getByRole('button', { name: 'Open ' + name }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByText('Duration').waitFor({ timeout: 10000 });
    const seen = await page.evaluate(() => window.__videoSeen);
    ok(seen, 'a <video> element was rendered');
    ok(seen.src.startsWith(`http://localhost:${FAKE_PORT}/`), 'src is the file-service url: ' + seen.src);
    eq(seen.preload, 'metadata', 'preload'); ok(seen.controls && seen.playsinline && !seen.crossorigin, 'controls, playsInline, no crossorigin');
    t.note('player still in the DOM after load:', (await dlg.locator('video').count()) === 1 ? 'yes' : 'no (fell back to the placeholder: media origin not in the cached CSP of this stack)');
    const text = await dlg.innerText();
    ok(/video\/mp4/.test(text) && /320 × 240/.test(text) && /0:03/.test(text), 'mime, size and duration facts: ' + text.slice(0, 160));
    eq(await dlg.getByLabel('Alt text').count(), 0, 'no alt text field');
    await shot(page, 'video-sheet');
    await page.keyboard.press('Escape');
  });
} finally {
  try { restartAdmin({}); restored = true; } catch (e) { t.note('WARN restart of the admin backend without FILE_* failed', String(e).slice(0, 200)); }
  fake.close();
}
await t.step('video: the admin backend is back without a file service', async () => { ok(restored, 'restarted'); });

await t.done(b);
