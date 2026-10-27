// IAM wire shapes (doc/05-api-spec.md section 3).
export type UserState = "active" | "invited" | "disabled" | "locked";

// `User` object returned by /users endpoints (no password hash/token).
export type User = {
  id: number;
  public_id: string;
  username: string;
  email: string | null;
  name: string;
  image: string;
  role_id: number;
  role_key: string;
  role_name: string;
  status: boolean;
  state: UserState;
  must_change_password: boolean;
  allowed_locales: string[];
  preferred_locale: string | null;
  last_login_at: string | null;
  password_changed_at: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
};

// GET /roles summary row (grants are only on GET /roles/{id}).
export type RoleSummary = {
  id: number;
  public_id: string;
  role_key: string;
  name: string;
  description: string;
  is_system: boolean;
  is_super: boolean;
  user_count: number;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

// One row of the permission matrix in GET /roles/{id}: every key of the catalog, `actions: []` = no access.
export type RolePermission = {
  permission_id: number;
  permission_key: string;
  name: string;
  description: string;
  category: string;
  available_actions: string[];
  actions: string[];
};

export type RoleDetail = RoleSummary & { permissions: RolePermission[] };

// GET /permissions: the catalog (22 keys) and the 15 actions with their meaning.
export type PermissionDef = {
  id: number;
  permission_key: string;
  name: string;
  description: string;
  category: string;
  available_actions: string[];
  sort_order: number;
};
export type ActionDef = { action: string; description: string };
export type PermissionCatalog = { permissions: PermissionDef[]; actions: ActionDef[] };

export type GrantInput = { permission_key: string; actions: string[] };
export type GrantChange = { permission_key: string; before: string[]; after: string[] };
// PUT /roles/{id}/permissions answer.
export type UpdateGrantsResult = { role: RoleDetail; changes: GrantChange[]; affected_users: number };

export type CreateRolePayload = {
  role_key: string;
  name: string;
  description?: string;
  copy_from_role_id?: number | null;
  sort_order?: number;
};
export type UpdateRolePayload = { name?: string; description?: string; sort_order?: number };

export type RolesListParams = {
  page?: number;
  limit?: number;
  keyword?: string;
  sort?: string;
};

// GET /users query (doc/05 section 3.1.1). `role_id` / `state` are comma lists (<= 10 values).
export type UsersListParams = {
  page?: number;
  limit?: number;
  keyword?: string;
  sort?: string;
  role_id?: string | number;
  state?: string;
};

// POST /users. `temporary_password` shows the password once; `invite` (P1) sends an e-mail.
export type CreateUserPayload = {
  name: string;
  username?: string;
  role_id: number;
  delivery: "temporary_password" | "invite";
  email?: string;
  allowed_locales?: string[];
};

export type CreateUserResult = {
  user: User;
  // Shown ONCE; null on an idempotent replay. Never store or log it.
  temporary_password: string | null;
  invitation_expires_at: string | null;
  email_delivery?: "queued" | "logged_only" | null;
};

// PATCH /users/{id}: only the fields that changed. `email: null` clears it (not for an `invited` user).
export type UpdateUserPayload = {
  name?: string;
  email?: string | null;
  role_id?: number;
  allowed_locales?: string[];
};

export type ResetPasswordDelivery = "email" | "temporary_password";
export type ResetPasswordResult = {
  delivery: ResetPasswordDelivery;
  // Shown ONCE; null for `email` or on an idempotent replay.
  temporary_password: string | null;
  link_expires_at: string | null;
  revoked_sessions: number;
  email_delivery?: "queued" | "logged_only" | null;
};
