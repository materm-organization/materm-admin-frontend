// Release 3 of video support, end to end on the real stack: the Hero (brand) form picks a background VIDEO next to the poster photo ->
// save -> publish -> portal backend API -> public site renders the <video>. Scratch stack only.
//   (a) a synthetic MP4 and a PNG poster are uploaded through the admin API (this spec starts a tiny FAKE file service on port 3205, restarts
//       ONLY the admin backend with FILE_* and the portal backend with MEDIA_BASE_URL, and restores both at the end)
//   (b) the page editor: choose the video + the poster, save the section, the props carry background_video.media_id
//   (c) the media kind rule through the API (422 kind_mismatch at both pointers) and in the editor (the real 422 of a rewritten request)
//   (d) publish; the portal API has the video + poster in the media map; the portal HTML has the <video> (muted loop playsinline poster, no controls)
//   (e) remove the video, save, publish again: the public page has no <video>
//   (f) deleting the media while the page uses it is refused (409)
// A synthetic MP4 is not decodable: nothing here asserts playback, only the DOM and the data.
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, suite, ok, eq, session, open, api, rootToken, newUser, TAG, shot, env, ADMIN_BE, PORTAL_BE, PORTAL_FE, sleep } from '../lib.mjs';

const t = suite('46 hero-video');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = await rootToken();
const b = await launch();
// A fresh editor (can publish pages) drives the editor and the page API: the server allows 60 publish calls per hour per user (dry runs count), which repeated runs on one stack would exhaust for the administrator.
const ED = await newUser(root, 'editor');
const { page, sink } = await session(b, { user: ED.username, pass: ED.password, viewport: { width: 1440, height: 1500 } });
t.page = page;
const toast = (re) => page.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: 12000 });
const PATH = '/e2e-hero-video-' + TAG; const TL = 'E2E_HERO_VIDEO_' + TAG;
const MP4_NAME = `e2e-hero-${TAG}.mp4`, PNG_NAME = `e2e-poster-${TAG}.png`;
let pageId, secId, videoId, posterId, videoUrl, posterUrl;

// ---- synthetic files (nothing of the user's) ----
const u32 = (v) => { const x = Buffer.alloc(4); x.writeUInt32BE(v >>> 0); return x; };
const box = (type, ...parts) => { const p = Buffer.concat(parts); return Buffer.concat([u32(8 + p.length), Buffer.from(type), p]); };
function mp4({ durationMs = 3000, width = 320, height = 240 } = {}) {
  const tkhd = Buffer.concat([Buffer.from([0, 0, 0, 3]), Buffer.alloc(36), ...[0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32), u32(width << 16), u32(height << 16)]);
  const trak = box('trak', box('tkhd', tkhd), box('mdia', box('hdlr', Buffer.alloc(8), Buffer.from('vide'), Buffer.alloc(13)),
    box('minf', box('stbl', box('stsd', Buffer.alloc(4), u32(1), box('avc1', Buffer.alloc(78)))))));
  const moov = box('moov', box('mvhd', Buffer.alloc(4), u32(0), u32(0), u32(1000), u32(durationMs), Buffer.alloc(80)), trak);
  const ftyp = box('ftyp', Buffer.from('isom'), u32(512), Buffer.from('isom'), Buffer.from('mp42'));
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.alloc(20000, 7), crypto.randomBytes(16))]);
}
function png(w = 32, h = 18) { // a real, decodable PNG (flat colour + a random pixel so every run is a different file)
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const td = Buffer.concat([Buffer.from(type), data]); return Buffer.concat([u32(data.length), td, u32(crc(td))]); };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 40; raw[o + 1] = 120; raw[o + 2] = 90; } }
  crypto.randomBytes(3).copy(raw, 1);
  const ihdr = Buffer.concat([u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- fake file service (the scratch stack has none) ----
const FAKE_PORT = 3205, FAKE_KEY = 'fake-46-' + TAG, FAKE_BUCKET = 'e2e-hero';
const store = new Map();
const fake = http.createServer(async (req, res) => {
  const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const p = req.url.split('?')[0];
    const hit = store.get(p) ?? [...store].find(([k]) => k.split('/').pop() === p.split('/').pop())?.[1];
    if (req.method === 'GET' && hit) { res.writeHead(200, { 'content-type': hit.type }); return res.end(hit.buf); }
    if (req.headers['x-api-key'] !== FAKE_KEY) return reply(401, { status: false });
    if (req.method === 'POST' && req.url === '/api/v1/file/upload') {
      const fd = await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: req, duplex: 'half' }).formData();
      const f = fd.get('FILES'), bucket = fd.get('BUCKET');
      store.set(`/buckets/${bucket}/${f.name}`, { buf: Buffer.from(await f.arrayBuffer()), type: f.type || 'application/octet-stream' });
      return reply(200, { status: true, data: { bucket, file_name: f.name, file_path: `/buckets/${bucket}/${f.name}` } });
    }
    if (req.method === 'DELETE' && req.url === '/api/v1/file/delete') { for await (const _ of req); return reply(200, { status: true }); }
    reply(404, { status: false });
  } catch (e) { reply(500, { status: false, err: String(e).slice(0, 100) }); }
});
const script = (name, extra) => execFileSync(path.join(HERE, '../../../..', name), { env: { ...process.env, ...extra }, stdio: 'pipe' });
const restartAdmin = (extra) => script('e2e-cross-system/05-restart-admin.sh', extra);
const restartPortal = (extra) => execFileSync(path.join(HERE, '..', 'restart-portal.sh'), { env: { ...process.env, ...extra }, stdio: 'pipe' });

const pget = async (p) => { const r = await fetch(PORTAL_BE + '/api/v1/public' + p, { headers: { 'x-portal-key': env.PORTAL_KEY, 'cache-control': 'no-cache' } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const resolveMedia = async () => { const r = await pget('/pages/resolve?path=' + encodeURIComponent(PATH)); return { status: r.status, d: r.body?.data }; };
const html = async () => { const r = await fetch(PORTAL_FE + PATH, { headers: { 'cache-control': 'no-cache' } }); return { status: r.status, html: await r.text() }; };
const waitFor = async (fn, pred, ms = 25000, every = 250) => { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (pred(last)) return { value: last, ms: Date.now() - t0 }; await sleep(every); } throw new Error('timeout; last ' + JSON.stringify(last).slice(0, 300)); };
const heroProps = async () => (await api(ED.token, 'GET', `/pages/${pageId}/sections?include=props`)).body.data[0].props;
const etagOf = async () => (await api(ED.token, 'GET', `/pages/${pageId}`)).etag;
const patchHero = (props) => fetch(`${ADMIN_BE}/api/v1/pages/${pageId}/sections/${secId}`, { method: 'PATCH', headers: { authorization: 'Bearer ' + ED.token, 'content-type': 'application/json', 'if-match': ETAG }, body: JSON.stringify({ props }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
let ETAG;
const upload = async (name, buf, type) => {
  const fd = new FormData(); fd.append('file', new Blob([buf], { type }), name);
  const r = await fetch(ADMIN_BE + '/api/v1/media/uploads', { method: 'POST', headers: { authorization: 'Bearer ' + root }, body: fd });
  const j = await r.json(); eq(r.status, 201, `upload ${name} -> ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.data.asset ?? j.data;
};
const picker = async (button, dialogName, file) => {
  await page.getByRole('button', { name: button }).click();
  const dlg = page.getByRole('dialog', { name: dialogName });
  await dlg.waitFor({ timeout: 8000 });
  await dlg.getByLabel('Search by file name').fill(file);
  return dlg;
};

await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r));
let restored = false;
try {
  restartAdmin({ FILE_HOST: '127.0.0.1', FILE_PORT: String(FAKE_PORT), FILE_KEY: FAKE_KEY, FILE_BUCKET: FAKE_BUCKET, FILE_PATH_IP: `http://localhost:${FAKE_PORT}` });
  restartPortal({ MEDIA_BASE_URL: `http://localhost:${FAKE_PORT}` });

  await t.step('(a) upload a synthetic MP4 and a PNG poster: kind video with duration, kind image', async () => {
    const v = await upload(MP4_NAME, mp4({ durationMs: 3000 }), 'video/mp4');
    const p = await upload(PNG_NAME, png(), 'image/png');
    videoId = v.id; posterId = p.id; videoUrl = v.url; posterUrl = p.url;
    // the poster gets an alt text so that it is a normal, publishable image for the specs that pick "the newest image" after this one (reruns on the same stack)
    const cur = await api(root, 'GET', `/media/assets/${p.id}`);
    const alt = await api(root, 'PATCH', `/media/assets/${p.id}`, { translations: { la: { alt: 'E2E poster' }, en: { alt: 'E2E poster' } } }, { 'if-match': cur.etag });
    ok(alt.status === 200, 'poster alt ' + alt.status + ' ' + JSON.stringify(alt.body).slice(0, 160));
    eq(v.kind, 'video', 'video kind'); eq(p.kind, 'image', 'poster kind');
    ok(v.duration_ms >= 2900 && v.duration_ms <= 3100, 'duration_ms ' + v.duration_ms);
    return { videoId, posterId, videoUrl };
  });

  await t.step('page: create from the Standard template and land in the editor', async () => {
    await open(page, '/admin/pages');
    await page.getByRole('button', { name: /new page/i }).click();
    const dlg = page.getByRole('dialog'); const ins = dlg.locator('input');
    await ins.nth(0).fill('E2E hero video ' + TAG); await ins.nth(1).fill(PATH);
    await dlg.getByRole('button', { name: 'Create page' }).click();
    await page.waitForURL(/\/admin\/pages\/\d+/, { timeout: 15000 });
    pageId = Number(new URL(page.url()).pathname.split('/').pop()); ok(pageId > 0, 'id');
    await page.getByRole('button', { name: /^Publish$/ }).waitFor();
    secId = (await api(ED.token, 'GET', `/pages/${pageId}/sections`)).body.data[0].id;
    await page.getByText('Hero (brand)').first().click(); // the section editor opens on a click (?section=<id>)
    await page.locator('textarea[id$="_title_la"]').first().waitFor({ timeout: 10000 });
  });

  await t.step('(b) the hero form shows the empty video control with its label and help; the poster picker offers images only', async () => {
    await page.getByText('Background video (optional)').first().waitFor({ timeout: 10000 });
    await page.getByText('No background video').waitFor();
    ok(await page.getByRole('button', { name: 'Choose video' }).isEnabled(), 'Choose video enabled');
    ok(/Plays muted on a loop behind the title/.test(await page.locator('body').innerText()), 'help text');
    const dlg = await picker('Choose image', 'Choose an image', `e2e-`);
    await dlg.getByRole('button', { name: PNG_NAME }).waitFor({ timeout: 8000 });
    eq(await dlg.getByRole('button', { name: MP4_NAME }).count(), 0, 'the image picker does not offer the video');
    await page.keyboard.press('Escape');
  });

  await t.step('(b) choose the poster (decorative) and the video through the new control; the tile shows name, duration and size', async () => {
    await page.locator('textarea[id$="_title_la"]').first().fill(TL);
    let dlg = await picker('Choose image', 'Choose an image', PNG_NAME);
    await dlg.getByRole('button', { name: PNG_NAME }).click();
    await page.getByRole('switch', { name: 'Decorative image (no alt text)' }).click();
    ok(await page.locator('[data-slot=poster-hint]').count() === 0, 'no poster hint before a video is chosen');
    dlg = await picker('Choose video', 'Choose a video', MP4_NAME);
    await dlg.getByRole('button', { name: MP4_NAME }).waitFor({ timeout: 8000 });
    eq(await dlg.getByRole('button', { name: PNG_NAME }).count(), 0, 'the video picker does not offer the photo');
    await dlg.getByRole('button', { name: MP4_NAME }).click();
    const tile = page.locator('[data-slot=media-video-preview]').locator('xpath=ancestor::fieldset[1]');
    await tile.locator('[data-slot=video-filename]').waitFor({ timeout: 8000 });
    eq((await tile.locator('[data-slot=video-filename]').innerText()).trim(), MP4_NAME, 'file name');
    ok(/0:03/.test(await tile.locator('[data-slot=video-meta]').innerText()), 'duration m:ss + size: ' + await tile.locator('[data-slot=video-meta]').innerText());
    ok(await page.getByRole('button', { name: 'Change video' }).isEnabled() && await page.getByRole('button', { name: 'Remove video' }).isEnabled(), 'Change + Remove');
    ok(/shown first and is used as the poster/.test(await page.locator('[data-slot=poster-hint]').innerText()), 'poster hint under the photo');
    await shot(page, '46-hero-form');
  });

  await t.step('(b) save the section: the props carry background_video.media_id and the poster; reload shows the video in the control', async () => {
    await page.getByRole('button', { name: 'Save section' }).click(); await page.waitForTimeout(2000);
    const bad = sink.http.filter((h) => /sections/.test(h.path) && h.status >= 400); ok(bad.length === 0, JSON.stringify(bad));
    const props = await heroProps();
    eq(props.background_video?.media_id, videoId, 'background_video.media_id'); eq(props.background?.media_id, posterId, 'background.media_id');
    eq(Object.keys(props.background_video).join(), 'media_id', 'no extra members');
    await page.reload(); await page.locator('[data-slot=video-filename]').waitFor({ timeout: 15000 });
    eq((await page.locator('[data-slot=video-filename]').innerText()).trim(), MP4_NAME, 'after reload');
  });

  await t.step('(c) API: a video in the poster slot and a photo in the video slot are 422 kind_mismatch at the field pointer with params', async () => {
    const props = await heroProps(); ETAG = await etagOf();
    const a = await patchHero({ ...props, background: { media_id: videoId, decorative: true } });
    eq(a.status, 422, 'video in poster slot'); const ea = a.body.errors?.[0];
    eq(ea?.path, '/props/background/media_id', 'pointer'); eq(ea?.code, 'kind_mismatch', 'code');
    eq(ea?.params?.expected_kind, 'image', 'expected_kind'); eq(ea?.params?.actual_kind, 'video', 'actual_kind');
    const c = await patchHero({ ...props, background_video: { media_id: posterId } });
    eq(c.status, 422, 'photo in video slot'); const ec = c.body.errors?.[0];
    eq(ec?.path, '/props/background_video/media_id', 'pointer'); eq(ec?.code, 'kind_mismatch', 'code');
    eq(ec?.params?.expected_kind, 'video', 'expected_kind'); eq(ec?.params?.actual_kind, 'image', 'actual_kind');
    t.note('request: PATCH /pages/{id}/sections/{sid} {props:{background:{media_id:<video>}}} -> 422', JSON.stringify(ea));
    eq(JSON.stringify(await heroProps()), JSON.stringify(props), 'nothing was saved');
  });

  await t.step('(c) editor: the real 422 of a request whose video slot was rewritten to the photo shows the readable message at the control', async () => {
    await page.route(/\/pages\/\d+\/sections\/\d+$/, async (route) => {
      const req = route.request();
      if (req.method() !== 'PATCH') return route.continue();
      const body = JSON.parse(req.postData() || '{}');
      if (body.props?.background_video) body.props.background_video.media_id = posterId; // the server decides, not the page
      return route.continue({ postData: JSON.stringify(body) });
    });
    await page.getByRole('button', { name: 'Change video' }).waitFor();
    await page.locator('textarea[id$="_title_la"]').first().fill(TL + ' x');
    await page.getByRole('button', { name: 'Save section' }).click();
    await page.getByText('This file is a photo; pick a video here.').waitFor({ timeout: 10000 });
    ok(sink.http.some((h) => h.status === 422 && /sections/.test(h.path)), 'the server answered 422');
    await shot(page, '46-kind-mismatch');
    await page.unroute(/\/pages\/\d+\/sections\/\d+$/);
    await page.reload(); await page.locator('[data-slot=video-filename]').waitFor({ timeout: 15000 });
  });

  await t.step('SEO title (required for publish) and the publish of the page', async () => {
    await page.getByRole('tab', { name: 'SEO' }).click();
    await page.locator('#page-field-seo_title-la').fill('E2E hero video ' + TAG);
    await page.getByRole('button', { name: 'Save draft' }).click(); await page.waitForTimeout(1800);
    await page.getByRole('tab', { name: 'Content' }).click();
  });

  let t0;
  await t.step('(d) publish: the portal API media map has the video (kind video, duration, bytes, mime) and the poster', async () => {
    await page.getByRole('button', { name: /^Publish$/ }).click();
    const dlg = page.getByRole('dialog'); await dlg.getByRole('button', { name: /^Publish$/ }).click({ timeout: 10000 });
    t0 = Date.now();
    await toast(/published/i);
    const toastMs = Date.now() - t0;
    const { value, ms } = await waitFor(resolveMedia, (x) => x.status === 200 && x.d?.media?.[String(videoId)]);
    const v = value.d.media[String(videoId)], p = value.d.media[String(posterId)];
    eq(v.kind, 'video', 'kind'); ok(v.duration_ms >= 2900 && v.duration_ms <= 3100, 'duration_ms ' + v.duration_ms);
    ok(typeof v.bytes === 'number' && v.bytes > 20000, 'bytes ' + v.bytes); eq(v.mime ?? v.mime_type, 'video/mp4', 'mime');
    ok(String(v.url).startsWith(`http://localhost:${FAKE_PORT}/`), 'file-service url ' + v.url);
    ok(p && p.kind !== 'video' && String(p.url).startsWith(`http://localhost:${FAKE_PORT}/`), 'poster item ' + JSON.stringify(p).slice(0, 160));
    const sec = value.d.sections[0]; eq(sec.props.background_video.media_id, videoId, 'section props'); eq(sec.props.background.media_id, posterId, 'poster in props');
    t.note(`TIMING publish toast ${toastMs} ms; portal API shows the video ${ms} ms after the toast (${Date.now() - t0} ms after the click)`);
    return { portalApiMs: Date.now() - t0 };
  });

  await t.step('(d) the portal HTML has the <video> (src = file service, muted loop playsinline, poster, no controls) and the poster image', async () => {
    const { value, ms } = await waitFor(html, (x) => x.status === 200 && x.html.includes('<video'));
    const tag = value.html.match(/<video\b[^>]*>/)[0];
    const src = value.html.match(/<video\b[\s\S]*?<\/video>/)[0];
    ok(src.includes(`http://localhost:${FAKE_PORT}/`), 'src is the file-service url: ' + src.slice(0, 300));
    ok(/\bmuted\b/.test(tag) && /\bloop\b/.test(tag) && /playsinline/i.test(tag), 'muted loop playsinline: ' + tag);
    ok(/\bposter="[^"]+"/.test(tag), 'poster attribute: ' + tag); ok(!/\bcontrols\b/.test(tag), 'no controls: ' + tag);
    ok(/video\/mp4/.test(src) || src.includes('<source'), 'source type');
    ok(value.html.includes(TL), 'the title is there');
    ok(new RegExp(`<img[^>]+src="${posterUrl}"`).test(value.html), 'the poster <img> is still in the page');
    t.note(`TIMING portal frontend shows the <video> ${ms} ms after the first poll and ${Date.now() - t0} ms after the Publish click`);
    const dom = await b.newPage(); await dom.goto(PORTAL_FE + PATH, { waitUntil: 'domcontentloaded' }); await dom.waitForTimeout(1500);
    const seen = await dom.evaluate(() => { const v = document.querySelector('video'); return { video: !!v, controls: v?.hasAttribute('controls'), muted: v?.muted, loop: v?.loop, img: [...document.images].some((i) => /buckets\/.*\.png/.test(decodeURIComponent(i.currentSrc || i.src))), srcs: [...document.images].map((i) => decodeURIComponent(i.currentSrc || i.src)).filter((x) => /buckets/.test(x)), title: document.title, h1: document.querySelector('h1')?.textContent?.slice(0, 30) }; });
    t.note('rendered DOM after 1.5 s (a synthetic MP4 cannot decode: the page may already have removed the video; the poster must stay)', JSON.stringify(seen));
    ok(seen.controls !== true, 'never controls'); ok(seen.img, 'the poster <img> is in the rendered DOM: ' + JSON.stringify(seen.srcs));
    await dom.close();
  });

  await t.step('(f) deleting the media while the live page uses it is refused with 409', async () => {
    for (const id of [videoId, posterId]) {
      const cur = await api(root, 'GET', `/media/assets/${id}`);
      const r = await api(root, 'DELETE', `/media/assets/${id}`, undefined, { 'if-match': cur.etag });
      ok(r.status === 409 && /MEDIA_IN_USE|ENTITY_REFERENCED/.test(r.body?.code), `delete ${id}: ${r.status} ${r.body?.code}`);
    }
    t.note('DELETE /media/assets/{video} ->', JSON.stringify((await api(root, 'DELETE', `/media/assets/${videoId}`, undefined, { 'if-match': (await api(root, 'GET', `/media/assets/${videoId}`)).etag })).body).slice(0, 240));
  });

  await t.step('(e) remove the video in the editor and save: background_video is gone from the props (no null, no {})', async () => {
    await page.getByRole('button', { name: 'Remove video' }).click();
    await page.getByText('No background video').waitFor();
    ok(await page.locator('[data-slot=poster-hint]').count() === 0, 'the poster hint is gone');
    await page.getByRole('button', { name: 'Save section' }).click(); await page.waitForTimeout(2000);
    const props = await heroProps();
    ok(!('background_video' in props), 'member removed: ' + JSON.stringify(props.background_video)); eq(props.background?.media_id, posterId, 'poster kept');
  });

  await t.step('(e) publish again: the public page has no <video>, the poster image stays', async () => {
    await page.getByRole('button', { name: /Publish changes/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish changes' }).click(); await toast(/published/i);
    const t1 = Date.now();
    const { value, ms } = await waitFor(html, (x) => x.status === 200 && !x.html.includes('<video'));
    ok(value.html.includes(TL), 'title still there'); ok(value.html.includes(posterUrl), 'poster image still there');
    const m = await resolveMedia(); ok(!m.d.media?.[String(videoId)], 'video left the media map');
    t.note(`TIMING public page without the <video> ${ms} ms after the toast (${Date.now() - t1} ms)`);
  });

  await t.step('the editor produced no 5xx and no page error', async () => {
    const bad = sink.http.filter((h) => h.status >= 500); ok(bad.length === 0, JSON.stringify(bad));
    const pe = sink.console.filter((c) => c.startsWith('PAGEERROR')); ok(pe.length === 0, pe.join(' | '));
  });
} finally {
  try { restartAdmin({}); restartPortal({}); restored = true; } catch (e) { t.note('WARN restart without the fake file service failed', String(e).slice(0, 200)); }
  fake.close();
}
await t.step('the admin and portal backends are back without a file service', async () => { ok(restored, 'restarted'); });
await t.done(b);
