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
};

export type UsersListParams = {
  page?: number;
  limit?: number;
  keyword?: string;
};

// POST /users. P0 only supports `delivery: "temporary_password"` (`invite`
// is P1 and answers 422 not_in_enum).
export type CreateUserPayload = {
  name: string;
  username: string;
  role_id: number;
  delivery: "temporary_password";
  email?: string;
  allowed_locales?: string[];
};

export type CreateUserResult = {
  user: User;
  // Shown ONCE; null on an idempotent replay. Never store or log it.
  temporary_password: string | null;
  invitation_expires_at: string | null;
};
