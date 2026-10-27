// Auth wire shapes (login, current user, change password) — doc/05-api-spec.md
// section 2.

export type LoginPayload = {
  username: string;
  password: string;
};

// POST /login response — tokens only, no user payload. The caller follows up
// with GET /auth/me (useFetchCurrentUser) once the tokens are stored.
// `GET /jwt/refresh` returns the same shape (a NEW refresh token each time —
// rotation — which must replace the stored one).
export type LoginResponse = {
  access: string;
  refresh: string;
  // Seconds the access token lives (900).
  expires_in?: number;
};

// One permission the current user holds (GET /auth/me). `actions` is never
// omitted/null. `[]` means NO access (doc/00 section 3 — this REVERSES the old
// legacy meaning of "full access"), and /auth/me already omits grants that
// lack `read`, so a key present in the list implies `read`. Always check an
// action with `userHasAction` / `useHasAction`, never by key presence alone.
export type PermissionGrant = {
  id: number;
  permission_key: string;
  name: string;
  description: string;
  category: string;
  actions: string[];
};

// GET /auth/me response (dto.UserDTO) — drives the route guard and the
// sidebar's permission filtering via `permissions[].permission_key`, not a
// single `role` string.
export type CurrentUser = {
  id: number;
  name: string;
  username: string;
  image: string;
  roleID: number;
  role_name: string;
  status: boolean;
  // True after an admin created the account with a temporary password or
  // forced a change: every endpoint except the allow-list (/auth/me,
  // /auth/users/change-password, /auth/logout, /jwt/refresh) answers 403
  // PASSWORD_CHANGE_REQUIRED until the user changes it.
  must_change_password: boolean;
  permissions: PermissionGrant[];
};

export type ChangePasswordPayload = {
  old_password: string;
  new_password: string;
};

// --- P1 self-service auth (doc/05 sections 2.6 - 2.10) ---

export type ForgotPasswordPayload = { identifier: string };

export type ResetPasswordPayload = { token: string; new_password: string };

export type InvitationVerifyResult = {
  email: string;
  name: string;
  role_name: string;
  expires_at: string;
  // Null when the e-mail's local part is too short or already taken.
  suggested_username: string | null;
};

export type AcceptInvitationPayload = {
  token: string;
  username: string;
  password: string;
  // Omitted = the name the inviter typed.
  name?: string;
};

// GET /auth/profile (+ ETag). `email` and the role are read-only here.
export type UserProfile = {
  id: number;
  public_id: string;
  username: string;
  name: string;
  email: string | null;
  role_key: string;
  role_name: string;
  preferred_locale: string | null;
  allowed_locales: string[];
  last_login_at: string | null;
  password_changed_at: string | null;
};

export type UpdateProfilePayload = { name?: string; preferred_locale?: string | null };
