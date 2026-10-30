// Sign-in / sign-out, forced password change, session expiry (revoked sessions), forgot-password neutrality.
import crypto from 'node:crypto';
import { launch, suite, ok, session, rootToken, api, newUser, ADMIN_FE, env } from '../lib.mjs';

const t = suite('00 auth');
const root = await rootToken();
const b = await launch();

const fillSignIn = async (page, user, pass) => {
  await page.goto(ADMIN_FE + '/auth/sign-in', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="username"]').fill(user); await page.locator('input[type="password"]').fill(pass);
  await page.locator('button[type="submit"]').click();
};

await t.step('wrong password stays on sign-in and shows an error', async () => {
  const { page, ctx } = await session(b, { signin: false });
  await fillSignIn(page, env.ADMIN_USER, 'definitely-wrong-password');
  await page.getByText(/password is incorrect/i).first().waitFor({ timeout: 10000 });
  ok(new URL(page.url()).pathname.startsWith('/auth/sign-in'), 'left sign-in');
  await ctx.close();
});

await t.step('signed-out visit of a protected page goes to sign-in', async () => {
  const { page, ctx } = await session(b, { signin: false });
  await page.goto(ADMIN_FE + '/admin/users', { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => u.pathname.startsWith('/auth/sign-in'), { timeout: 15000 });
  await ctx.close();
});

const tmpUser = await newUser(root, 'editor', { keepTemp: true });
await t.step('temporary password: only the forced change dialog is shown, mismatch is refused, then dashboard', async () => {
  const { page, ctx } = await session(b, { signin: false });
  await fillSignIn(page, tmpUser.username, tmpUser.password);
  const dlg = page.getByRole('dialog'); await dlg.waitFor({ timeout: 20000 });
  ok(await dlg.getByText(/must set a new password/i).count() > 0, 'forced description');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok(await dlg.isVisible(), 'the forced dialog cannot be dismissed with Escape');
  const newPw = 'E2e-' + crypto.randomBytes(8).toString('hex') + '-Pw!';
  await dlg.locator('input[name=oldPassword]').fill(tmpUser.password);
  await dlg.locator('input[name=password]').fill(newPw);
  await dlg.locator('input[name=confirmPassword]').fill(newPw + 'x');
  await dlg.getByRole('button', { name: 'Change password' }).click();
  await dlg.getByText(/do not match/i).first().waitFor({ timeout: 5000 });
  await dlg.locator('input[name=confirmPassword]').fill(newPw);
  await dlg.getByRole('button', { name: 'Change password' }).click();
  await dlg.waitFor({ state: 'detached', timeout: 20000 });
  await page.getByRole('heading', { name: /dashboard/i }).first().waitFor({ timeout: 15000 }).catch(() => {});
  ok((await page.locator('[data-sidebar="menu-button"], a[data-slot^="sidebar-menu"]').count()) > 0, 'sidebar visible after change');
  tmpUser.password = newPw; await ctx.close();
});

await t.step('sign out from the user menu returns to sign-in and the page is protected again', async () => {
  const { page, ctx } = await session(b, { user: tmpUser.username, pass: tmpUser.password });
  await page.locator('[data-slot="sidebar-footer"] [data-slot="dropdown-menu-trigger"]').click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /sign out/i }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/auth/sign-in'), { timeout: 15000 });
  await page.goto(ADMIN_FE + '/admin/roles', { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => u.pathname.startsWith('/auth/sign-in'), { timeout: 15000 });
  await ctx.close();
});

await t.step('session expiry: revoked sessions end in sign-in with the "session has ended" notice', async () => {
  const u = await newUser(root, 'viewer');
  const { page, ctx } = await session(b, { user: u.username, pass: u.password });
  const rv = await api(root, 'POST', `/users/${u.id}/revoke-sessions`, {}, { 'idempotency-key': crypto.randomUUID() });
  ok([200, 204].includes(rv.status), 'revoke-sessions ' + rv.status + ' ' + rv.body?.code);
  await page.reload({ waitUntil: 'domcontentloaded' });
  // the notice is a toast of about 4 s: wait for it right away
  await page.getByText(/session has ended/i).first().waitFor({ timeout: 20000 });
  ok(new URL(page.url()).pathname.startsWith('/auth/sign-in'), 'on sign-in');
  await ctx.close();
});

await t.step('forgot-password answers with the same neutral text for unknown accounts', async () => {
  const { page, ctx } = await session(b, { signin: false });
  await page.goto(ADMIN_FE + '/auth/forgot-password', { waitUntil: 'domcontentloaded' });
  await page.locator('input').first().fill('nobody.' + crypto.randomBytes(3).toString('hex'));
  await page.getByRole('button', { name: /send reset link/i }).click();
  await page.getByText(/check your inbox/i).first().waitFor({ timeout: 10000 });
  await ctx.close();
});

await t.done(b);
