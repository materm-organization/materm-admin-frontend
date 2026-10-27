import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { RolesAPI, UsersAPI } from "@/services/users.api";
import type { CreateUserPayload, UsersListParams } from "@/types/iam";

export const useUsers = (params: UsersListParams) =>
  useQuery({
    queryKey: [API_ENDPOINTS.USERS.LIST, params],
    queryFn: () => UsersAPI.List(params),
    placeholderData: keepPreviousData,
  });

export const useRoles = (enabled = true) =>
  useQuery({
    queryKey: [API_ENDPOINTS.ROLES.LIST],
    queryFn: () => RolesAPI.List(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

// The result holds the one-time temporary password: `gcTime: 0` drops it from
// the mutation cache as soon as nothing observes it (React Query devtools
// would otherwise keep showing it), and callers copy it into local state in
// `onSuccess` and call `reset()`.
export const useMutationCreateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateUserPayload; idempotencyKey?: string }) =>
      UsersAPI.Create(payload, idempotencyKey),
    gcTime: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.USERS.LIST] });
    },
  });
};
