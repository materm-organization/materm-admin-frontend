// Visual sweep of the production build in the running E2E stack (run.sh up first): every screen x 1440/1024/390 x light/dark x la/en.
// Saves screenshots (JPEG) + metrics.json (horizontal overflow, clipped text, low contrast) under OUT (default tests/e2e/results/eye).
//   node tests/e2e/eye-check.mjs [--only=users,roles] [--vp=1440,390] [--theme=dark] [--lang=la]
import fs from 'node:fs';
import path from 'node:path';
import { launch, session, rootToken, api, ADMIN_FE, RESULTS } from './lib.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const OUT = process.env.OUT || path.join(RESULTS, 'eye'); fs.mkdirSync(OUT, { recursive: true });
const VPS = arg('vp', '1440,1024,390').split(',').map(Number); const THEMES = arg('theme', 'light,dark').split(','); const LANGS = arg('lang', 'la,en').split(',');
const only = arg('only', '').split(',').filter(Boolean);
const root = await rootToken();
const firstId = async (p) => (await api(root, 'GET', p)).body?.data?.[0]?.id;
const albumId = await firstId('/albums'); const faqId = await firstId('/faq-groups'); const postId = await firstId('/posts?limit=1');
const sec = (await api(root, 'GET', '/pages/1/sections')).body?.data?.[0]?.id;
const SCREENS = [
  ['signin', '/auth/sign-in', false], ['forgot', '/auth/forgot-password', false],
  ['dashboard', '/admin'], ['users', '/admin/users'], ['user-detail', '/admin/users/1'], ['roles', '/admin/roles'], ['role-matrix', '/admin/roles/3'],
  ['audit', '/admin/audit'], ['locales', '/admin/locales'], ['system', '/admin/system'], ['media', '/admin/media'],
  ['menus', '/admin/menus'], ['menu-main', '/admin/menus/main'], ['settings-brand', '/admin/settings/brand'], ['settings-contact', '/admin/settings/contact'],
  ['settings-footer', '/admin/settings/footer'], ['settings-site', '/admin/settings/site'], ['seo', '/admin/seo'], ['ui-strings', '/admin/ui-strings'],
  ['categories', '/admin/blog/categories'], ['tags', '/admin/blog/tags'], ['pages', '/admin/pages'], ['page-content', '/admin/pages/1'],
  ['page-section', `/admin/pages/1?section=${sec}`], ['page-details', '/admin/pages/1?tab=details'], ['page-seo', '/admin/pages/1?tab=seo'], ['page-history', '/admin/pages/1?tab=revisions'],
  ['posts', '/admin/blog/posts'], ['post-editor', `/admin/blog/posts/${postId}`], ['galleries', '/admin/galleries'], ['gallery-editor', `/admin/galleries/${albumId}`],
  ['faq', '/admin/faq'], ['faq-editor', `/admin/faq/${faqId}`], ['forms', '/admin/forms'], ['form-editor', '/admin/forms/1'], ['inbox', '/admin/forms/submissions'], ['profile', '/admin/profile'],
].filter(([n]) => !only.length || only.includes(n));

// in-page audit: horizontal overflow, clipped text, low contrast
const AUDIT = () => {
  const out = { hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, clipped: [], contrast: [] };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[ ,/]+/).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; } const l = s.match(/oklch|lab|color/); return null; };
  const canvas = document.createElement('canvas').getContext('2d');
  const norm = (col) => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = '#000'; canvas.fillStyle = col; canvas.fillRect(0, 0, 1, 1); const d = canvas.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(norm(getComputedStyle(e).backgroundColor)); let bg = getComputedStyle(document.documentElement).colorScheme.includes('dark') || document.documentElement.classList.contains('dark') ? [10, 10, 12] : [255, 255, 255]; for (const c of chain) { const a = c[3]; if (a > 0) bg = [0, 1, 2].map((i) => c[i] * a + bg[i] * (1 - a)); } return [...bg, 1]; };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!own) continue;
    if (r.width <= 2 || r.height <= 2) continue; // sr-only
    const scrollParent = (() => { for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if ((o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth) return true; } return false; })();
    const tag = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.getAttribute('data-slot') ? '[' + el.getAttribute('data-slot') + ']' : '');
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis') { const k = 'c' + tag + own.slice(0, 30); if (!seen.has(k)) { seen.add(k); out.clipped.push(`${tag} "${own.slice(0, 40)}" ${el.scrollWidth}>${el.clientWidth}`); } }
    if (!scrollParent && r.right > document.documentElement.clientWidth + 2 && r.left < document.documentElement.clientWidth) { const k = 'o' + tag + own.slice(0, 30); if (!seen.has(k)) { seen.add(k); out.clipped.push(`OFFSCREEN ${tag} "${own.slice(0, 40)}" right=${Math.round(r.right)}`); } }
    const fg = norm(cs.color); const bg = bgOf(el); const a = fg[3]; const f = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    const L1 = lum(f), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize), large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5) && !el.closest('[disabled], [aria-disabled=true]') && !(el.closest('button') && el.closest('button').disabled)) { const k = 'k' + tag + own.slice(0, 20); if (!seen.has(k)) { seen.add(k); out.contrast.push(`${ratio.toFixed(2)} ${tag} "${own.slice(0, 40)}" ${cs.color}`); } }
  }
  out.clipped = out.clipped.slice(0, 12); out.contrast = out.contrast.slice(0, 12); return out;
};

const b = await launch(); const metrics = [];
for (const lang of LANGS) for (const theme of THEMES) for (const vp of VPS) {
  const height = vp === 390 ? 844 : vp === 1024 ? 768 : 900;
  const ctx = await b.newContext({ viewport: { width: vp, height }, colorScheme: theme });
  await ctx.addCookies([{ name: 'locale', value: lang, url: ADMIN_FE }]); ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage(); page.on('dialog', (d) => d.accept().catch(() => {}));
  const { signIn } = await import('./lib.mjs');
  let signedIn = false;
  for (const [name, url, auth = true] of SCREENS) {
    if (auth && !signedIn) { await signIn(page); signedIn = true; }
    if (!auth && signedIn) { await ctx.clearCookies(); await ctx.addCookies([{ name: 'locale', value: lang, url: ADMIN_FE }]); signedIn = false; }
    const tag = `${name}.${vp}.${theme}.${lang}`;
    try {
      await page.goto(ADMIN_FE + url, { waitUntil: 'domcontentloaded' }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(900);
      const m = await page.evaluate(AUDIT);
      await page.screenshot({ path: path.join(OUT, tag + '.jpg'), type: 'jpeg', quality: 62, fullPage: true });
      metrics.push({ tag, path: new URL(page.url()).pathname, ...m });
      if (m.hscroll > 1 || m.clipped.length || m.contrast.length) console.log(tag, `hscroll=${m.hscroll} clipped=${m.clipped.length} contrast=${m.contrast.length}`);
    } catch (e) { metrics.push({ tag, error: e.message.split('\n')[0] }); console.log(tag, 'ERROR', e.message.split('\n')[0]); }
  }
  await ctx.close();
}
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 1));
console.log('screens', metrics.length, 'with hscroll', metrics.filter((m) => m.hscroll > 1).length, 'with clipped', metrics.filter((m) => m.clipped?.length).length, 'with contrast', metrics.filter((m) => m.contrast?.length).length);
await b.close();
