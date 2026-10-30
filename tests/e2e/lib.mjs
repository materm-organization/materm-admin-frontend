// Helpers of the admin E2E suite. Browser + API plumbing comes from the cross-system harness (../../../e2e-cross-system/lib/lib.mjs,
// used as is: it reads the work dir of the running stack, launches system Chrome, signs in, calls the admin API).
// Everything here is read-only for that harness. Secrets are never printed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
export { launch, watch, signIn, env, ADMIN_BE, ADMIN_FE, PORTAL_FE, PORTAL_BE, apiLogin, api, sleep, WORK } from '../../../e2e-cross-system/lib/lib.mjs';
import { watch, signIn, ADMIN_BE, ADMIN_FE, api, apiLogin } from '../../../e2e-cross-system/lib/lib.mjs';

export const RESULTS = path.join(path.dirname(new URL(import.meta.url).pathname), 'results');
fs.mkdirSync(RESULTS, { recursive: true });
export const TAG = Date.now().toString(36);

/** A spec: `const t = suite('name'); await t.step('does x', async () => {...}); await t.done()`. A step passes when its fn does not throw. */
export function suite(name) {
  const rows = []; let failed = 0; let n = 0;
  console.log(`# ${name}`);
  return {
    async step(label, fn) {
      const t0 = Date.now();
      try { const extra = await fn(); rows.push({ label, ok: true }); console.log('PASS', label, extra ? JSON.stringify(extra).slice(0, 200) : ''); }
      catch (e) { failed++; n++; if (this.page) await this.page.screenshot({ path: path.join(RESULTS, name.split(' ')[0] + '-fail-' + n + '.png') }).catch(() => {}); rows.push({ label, ok: false, err: String(e.message).split('\n')[0] }); console.log('FAIL', label, '::', String(e.message).split('\n').slice(0, 3).join(' | ').slice(0, 400), `(${Date.now() - t0} ms)`); }
    },
    page: null, // set `t.page = page` to get a screenshot of every failing step
    note(...a) { console.log('NOTE', ...a); },
    async done(...closers) {
      for (const c of closers) await c?.close().catch(() => {});
      fs.writeFileSync(path.join(RESULTS, name.replace(/\W+/g, '-') + '.json'), JSON.stringify(rows, null, 2));
      console.log(`# ${name}: ${rows.length - failed}/${rows.length} passed`);
      if (failed) process.exitCode = 1;
    },
  };
}
export const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
export const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
export const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(RESULTS, name + '.png'), ...opts });

/** Creates a user with the given role through the API (temporary password), changes the password, returns credentials + a token. */
export async function newUser(rootToken, roleKey, { keepTemp = false } = {}) {
  const roles = (await api(rootToken, 'GET', '/roles')).body.data;
  const role = roles.find((r) => r.role_key === roleKey); if (!role) throw new Error('role ' + roleKey);
  const username = `e2e.${roleKey}.${crypto.randomBytes(3).toString('hex')}`;
  const pw = 'E2e-' + crypto.randomBytes(8).toString('hex') + '-Pw!';
  const cu = await api(rootToken, 'POST', '/users', { name: 'E2E ' + roleKey, role_id: role.id, delivery: 'temporary_password', username }, { 'idempotency-key': crypto.randomUUID() });
  const tmp = cu.body?.data?.temporary_password; if (!tmp) throw new Error(`create user ${roleKey}: ${cu.status} ${cu.body?.code}`);
  const post = (p, b, h = {}) => fetch(ADMIN_BE + '/api/v1' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then((r) => r.json());
  if (keepTemp) return { username, password: tmp, id: cu.body.data.id ?? cu.body.data.user?.id, roleId: role.id };
  const lg = await post('/login', { username, password: tmp });
  await post('/auth/users/change-password', { old_password: tmp, new_password: pw }, { authorization: 'Bearer ' + lg.data.access });
  const token = (await post('/login', { username, password: pw })).data.access;
  return { username, password: pw, token, id: cu.body.data.id ?? cu.body.data.user?.id, roleId: role.id };
}

/** Opens a browser context (cookie locale, wide viewport), a page with the error sink, optionally signed in. */
export async function session(browser, { user, pass, locale = 'en', viewport = { width: 1440, height: 1000 }, signin = true } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: 'locale', value: locale, url: ADMIN_FE }]);
  ctx.setDefaultTimeout(12000);
  const page = await ctx.newPage(); const sink = watch(page);
  page.on('dialog', (d) => d.accept().catch(() => {})); // beforeunload of the unsaved-changes guard must not block the next step
  if (signin) await signIn(page, user, pass);
  return { ctx, page, sink };
}

/** Navigates and waits for the network to settle (the app polls nothing; networkidle is safe here). */
export async function open(page, p, { settle = 600 } = {}) {
  await page.goto(ADMIN_FE + p, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(settle);
}
export const alerts = (page) => page.evaluate(() => [...document.querySelectorAll('[role="alert"], [data-slot="alert"], [data-sonner-toast]')].map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 160)));
export const mainText = (page) => page.evaluate(() => (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' '));
/** Waits for a toast / any element text to appear. */
export const seeText = (page, re, timeout = 8000) => page.getByText(re).first().waitFor({ timeout });
export { apiLogin as rootToken };
