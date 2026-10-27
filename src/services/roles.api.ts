import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, ifMatchHeaders, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  CreateRolePayload,
  GrantInput,
  RoleDetail,
  RoleSummary,
  RolesListParams,
  UpdateGrantsResult,
  UpdateRolePayload,
} from "@/types/iam";

export const RolesAPI = {
  // Needs iam.roles:read OR iam.users:read (the user form uses it for the role choices).
  List: async (params: RolesListParams = { limit: 100 }) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<RoleSummary[]>>(API_ENDPOINTS.ROLES.LIST, {
      params: {
        page: params.page,
        limit: params.limit,
        keyword: params.keyword || undefined,
        sort: params.sort || undefined,
      },
    });
    return data;
  },
  // `{ data, etag }`: the ETag is the mandatory `If-Match` of PATCH /roles/{id} and PUT /roles/{id}/permissions.
  Get: async (id: number | string) =>
    withEtag(await axiosInstance.get<ApiResponse<RoleDetail>>(API_ENDPOINTS.ROLES.DETAIL(id))),
  // 201 + RoleDetail + ETag. `idempotencyKey`: once per dialog open.
  Create: async (payload: CreateRolePayload, idempotencyKey?: string) =>
    withEtag(
      await axiosInstance.post<ApiResponse<RoleDetail>>(API_ENDPOINTS.ROLES.CREATE, payload, {
        headers: idempotencyKeyHeaders(idempotencyKey),
      })
    ),
  // If-Match is REQUIRED (throws MissingEtagError instead of sending a request that gets 428).
  Update: async (id: number | string, payload: UpdateRolePayload, etag: string | undefined) =>
    withEtag(
      await axiosInstance.patch<ApiResponse<RoleDetail>>(
        API_ENDPOINTS.ROLES.DETAIL(id),
        payload,
        ifMatch(etag, { required: true })
      )
    ),
  Delete: async (id: number | string) => {
    const { data } = await axiosInstance.delete<ApiResponse<null>>(API_ENDPOINTS.ROLES.DETAIL(id));
    return data;
  },
  // Replaces the whole matrix: only rows with actions go in `grants` (a missing key loses its actions).
  // The answer carries the new ETag (of the updated role).
  UpdatePermissions: async (id: number | string, grants: GrantInput[], etag: string | undefined) =>
    withEtag(
      await axiosInstance.put<ApiResponse<UpdateGrantsResult>>(
        API_ENDPOINTS.ROLES.PERMISSIONS(id),
        { grants },
        { headers: ifMatchHeaders(etag, { required: true }) }
      )
    ),
};
