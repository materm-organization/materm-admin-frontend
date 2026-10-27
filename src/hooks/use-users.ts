import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { UsersAPI } from "@/services/users.api";
import type { ApiResponse } from "@/types/api";
import type {
  CreateUserPayload,
  ResetPasswordDelivery,
  UpdateUserPayload,
  User,
  UsersListParams,
} from "@/types/iam";

export { useRoles } from "@/hooks/use-roles";

export const userDetailKey = (id: number | string) => [API_ENDPOINTS.USERS.DETAIL(id)] as const;

export const useUsers = (params: UsersListParams, enabled = true) =>
  useQuery({
    queryKey: [API_ENDPOINTS.USERS.LIST, params],
    queryFn: () => UsersAPI.List(params),
    placeholderData: keepPreviousData,
    enabled,
  });

// One user + its ETag (`If-Match` of PATCH). A 404 is not retried by the query client (any 4xx).
export const useUser = (id: number | string) =>
  useQuery({
    queryKey: userDetailKey(id),
    queryFn: () => UsersAPI.Get(id),
  });

// A command/PATCH answered with the fresh user + new ETag: put it in the cache (no refetch), refresh the lists.
function cacheUser(queryClient: QueryClient, result: WithEtag<ApiResponse<User>>) {
  const user = result.data.data;
  if (result.etag) {
    queryClient.setQueryData(userDetailKey(user.id), result);
  } else {
    // No ETag came back: a stale one must not be reused for the next save.
    void queryClient.invalidateQueries({ queryKey: userDetailKey(user.id) });
  }
  void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.USERS.LIST] });
}

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

export const useMutationUpdateUser = (id: number | string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, etag }: { payload: UpdateUserPayload; etag?: string }) =>
      UsersAPI.Update(id, payload, etag),
    onSuccess: (result) => cacheUser(queryClient, result),
  });
};

export const useMutationDeleteUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number | string) => UsersAPI.Delete(id),
    // The detail entry stays (see useMutationDeleteRole): the caller redirects to the list.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.USERS.LIST] });
    },
  });
};

export type UserCommand = "activate" | "deactivate" | "unlock";

// activate / deactivate / unlock: one hook, the command is the variable.
export const useMutationUserCommand = (id: number | string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: UserCommand) =>
      command === "activate"
        ? UsersAPI.Activate(id)
        : command === "deactivate"
          ? UsersAPI.Deactivate(id)
          : UsersAPI.Unlock(id),
    onSuccess: (result) => cacheUser(queryClient, result),
  });
};

// `gcTime: 0` for the same reason as create: the answer can hold a one-time password.
export const useMutationResetPassword = (id: number | string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ delivery, idempotencyKey }: { delivery: ResetPasswordDelivery; idempotencyKey?: string }) =>
      UsersAPI.ResetPassword(id, delivery, idempotencyKey),
    gcTime: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userDetailKey(id) });
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.USERS.LIST] });
    },
  });
};

export const useMutationForcePasswordChange = (id: number | string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (revokeSessions: boolean) => UsersAPI.ForcePasswordChange(id, revokeSessions),
    onSuccess: (result) => cacheUser(queryClient, result),
  });
};

export const useMutationRevokeSessions = (id: number | string) =>
  useMutation({ mutationFn: () => UsersAPI.RevokeSessions(id) });

export const useMutationResendInvitation = (id: number | string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => UsersAPI.ResendInvitation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userDetailKey(id) });
    },
  });
};
