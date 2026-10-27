import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, withEtag } from "@/lib/etag";
import { idempotencyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  CreateUserPayload,
  CreateUserResult,
  ResetPasswordDelivery,
  ResetPasswordResult,
  UpdateUserPayload,
  User,
  UsersListParams,
} from "@/types/iam";

export const UsersAPI = {
  // `role_id` / `state` are comma lists, `sort` an allow-listed field (`-field` = descending).
  List: async (params: UsersListParams) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<User[]>>(API_ENDPOINTS.USERS.LIST, {
      params: {
        page: params.page,
        limit: params.limit,
        keyword: params.keyword || undefined,
        sort: params.sort || undefined,
        role_id: params.role_id || undefined,
        state: params.state || undefined,
      },
    });
    return data;
  },
  // `{ data, etag }`: the ETag goes back as `If-Match` on PATCH (doc/05 section 1.12).
  Get: async (id: number | string) =>
    withEtag(await axiosInstance.get<ApiResponse<User>>(API_ENDPOINTS.USERS.DETAIL(id))),
  // POST /users with delivery=temporary_password. The response carries the
  // temporary password ONCE — pass it to the dialog, never store or log it.
  // `idempotencyKey`: one key per dialog open (useIdempotencyKey), so a retry is a replay.
  Create: async (payload: CreateUserPayload, idempotencyKey?: string) => {
    const { data } = await axiosInstance.post<ApiResponse<CreateUserResult>>(
      API_ENDPOINTS.USERS.CREATE,
      payload,
      idempotencyHeaders(idempotencyKey)
    );
    return data;
  },
  // `If-Match` is recommended here (not mandatory): sent whenever the ETag is known.
  Update: async (id: number | string, payload: UpdateUserPayload, etag?: string) =>
    withEtag(
      await axiosInstance.patch<ApiResponse<User>>(API_ENDPOINTS.USERS.DETAIL(id), payload, ifMatch(etag))
    ),
  Delete: async (id: number | string) => {
    const { data } = await axiosInstance.delete<ApiResponse<null>>(API_ENDPOINTS.USERS.DETAIL(id));
    return data;
  },
  // activate / deactivate / unlock answer the fresh user (+ new ETag); repeating one is a no-op 200.
  Activate: async (id: number | string) =>
    withEtag(await axiosInstance.post<ApiResponse<User>>(API_ENDPOINTS.USERS.ACTIVATE(id))),
  Deactivate: async (id: number | string) =>
    withEtag(await axiosInstance.post<ApiResponse<User>>(API_ENDPOINTS.USERS.DEACTIVATE(id))),
  Unlock: async (id: number | string) =>
    withEtag(await axiosInstance.post<ApiResponse<User>>(API_ENDPOINTS.USERS.UNLOCK(id))),

  // --- P1 commands: the backend may not have them yet; a missing endpoint is an ordinary error (404/405). ---
  // The answer can hold the one-time temporary password: callers copy it into local state and reset the mutation.
  ResetPassword: async (id: number | string, delivery: ResetPasswordDelivery, idempotencyKey?: string) => {
    const { data } = await axiosInstance.post<ApiResponse<ResetPasswordResult>>(
      API_ENDPOINTS.USERS.RESET_PASSWORD(id),
      { delivery },
      idempotencyHeaders(idempotencyKey)
    );
    return data;
  },
  ForcePasswordChange: async (id: number | string, revokeSessions: boolean) =>
    withEtag(
      await axiosInstance.post<ApiResponse<User>>(API_ENDPOINTS.USERS.FORCE_PASSWORD_CHANGE(id), {
        revoke_sessions: revokeSessions,
      })
    ),
  RevokeSessions: async (id: number | string) => {
    const { data } = await axiosInstance.post<ApiResponse<{ revoked_sessions: number }>>(
      API_ENDPOINTS.USERS.REVOKE_SESSIONS(id)
    );
    return data;
  },
  ResendInvitation: async (id: number | string) => {
    const { data } = await axiosInstance.post<
      ApiResponse<{ invitation_expires_at: string; email_delivery?: "queued" | "logged_only" | null }>
    >(API_ENDPOINTS.USERS.RESEND_INVITATION(id));
    return data;
  },
};
