// Auth wire shapes (login, current user, change password). Adjust to match
// your own backend's DTOs.

export type LoginPayload = {
  username: string;
  password: string;
};

// POST /login response (dto.UserJWTDTO) — tokens only, no user payload.
// The caller is expected to follow up with GET /auth/me (useFetchCurrentUser)
// once the tokens are stored, same as a 401-triggered silent refresh does.
export type LoginResponse = {
  access: string;
  refresh: string;
};

// One permission a role (or, via GET /auth/me, the current user) holds —
// `actions` is never omitted/null, always `[]` at minimum (dto.PermissionDTO).
// Empty `actions` does NOT mean "no access" — see PermissionDTO's own
// comment in the backend: it means "not yet scoped to specific actions",
// i.e. full legacy access to everything under this permission.
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
  permissions: PermissionGrant[];
};

export type ChangePasswordPayload = {
  old_password: string;
  new_password: string;
};
