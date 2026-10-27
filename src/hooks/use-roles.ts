import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { useFetchCurrentUser } from "@/hooks/use-auth";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { RolesAPI } from "@/services/roles.api";
import type { ApiResponse } from "@/types/api";
import type {
  CreateRolePayload,
  GrantInput,
  RoleDetail,
  RolesListParams,
  UpdateRolePayload,
} from "@/types/iam";

export const roleDetailKey = (id: number | string) => [API_ENDPOINTS.ROLES.DETAIL(id)] as const;

// Role choices for forms and filters (up to 100, cached 5 min).
export const useRoles = (enabled = true) =>
  useQuery({
    queryKey: [API_ENDPOINTS.ROLES.LIST, "options"],
    queryFn: () => RolesAPI.List({ limit: 100 }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

// SCR-09 list (paged, sortable).
export const useRolesList = (params: RolesListParams) =>
  useQuery({
    queryKey: [API_ENDPOINTS.ROLES.LIST, params],
    queryFn: () => RolesAPI.List(params),
    placeholderData: keepPreviousData,
  });

// One role with its 22-row matrix + ETag (`If-Match` of PATCH and PUT).
export const useRole = (id: number | string, enabled = true) =>
  useQuery({
    queryKey: roleDetailKey(id),
    queryFn: () => RolesAPI.Get(id),
    enabled,
  });

function cacheRole(queryClient: QueryClient, id: number | string, role: RoleDetail, etag: string | undefined) {
  if (etag) {
    const entry: WithEtag<ApiResponse<RoleDetail>> = { data: { success: true, data: role }, etag };
    queryClient.setQueryData(roleDetailKey(id), entry);
  } else {
    // No ETag came back: a stale one must not be reused for the next save.
    void queryClient.invalidateQueries({ queryKey: roleDetailKey(id) });
  }
  void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ROLES.LIST] });
}

export const useMutationCreateRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateRolePayload; idempotencyKey?: string }) =>
      RolesAPI.Create(payload, idempotencyKey),
    onSuccess: (result) => cacheRole(queryClient, result.data.data.id, result.data.data, result.etag),
  });
};

export const useMutationUpdateRole = (id: number | string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, etag }: { payload: UpdateRolePayload; etag: string | undefined }) =>
      RolesAPI.Update(id, payload, etag),
    onSuccess: (result) => {
      cacheRole(queryClient, id, result.data.data, result.etag);
      // Other lists show the role name (users list, user form).
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.USERS.LIST] });
    },
  });
};

export const useMutationDeleteRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number | string) => RolesAPI.Delete(id),
    // The detail entry is left alone on purpose: removing it while the page is still mounted would refetch a
    // role that no longer exists (a flash of "not found") before the redirect to the list.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ROLES.LIST] });
    },
  });
};

// PUT the whole matrix. The new ETag from the answer replaces the cached one (otherwise the next save would
// send a stale If-Match and get a false conflict). A change to the signed-in user's own role re-reads /auth/me.
export const useMutationUpdateRolePermissions = (id: number | string) => {
  const queryClient = useQueryClient();
  const { data: me } = useFetchCurrentUser();
  return useMutation({
    mutationFn: ({ grants, etag }: { grants: GrantInput[]; etag: string | undefined }) =>
      RolesAPI.UpdatePermissions(id, grants, etag),
    onSuccess: (result) => {
      const { role } = result.data.data;
      cacheRole(queryClient, id, role, result.etag);
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.AUDIT.LIST] });
      if (me?.data.roleID === role.id) {
        // Prefix match: the real key carries a second element (dev bypass flag).
        void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.AUTH.ME] });
      }
    },
  });
};
