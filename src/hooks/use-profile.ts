import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { AuthAPI } from "@/services/auth.api";
import type { UpdateProfilePayload } from "@/types/user";

export const PROFILE_KEY = [API_ENDPOINTS.AUTH.PROFILE] as const;

// The signed-in user's own profile + its ETag (`If-Match` of the PATCH).
export const useProfile = () =>
  useQuery({ queryKey: PROFILE_KEY, queryFn: () => AuthAPI.GetProfile() });

// The answer carries the fresh profile and a NEW ETag: it goes straight into the cache (no refetch). `/auth/me`
// is refreshed too, so the sidebar shows the new name.
export const useMutationUpdateProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, etag }: { payload: UpdateProfilePayload; etag?: string }) =>
      AuthAPI.UpdateProfile(payload, etag),
    onSuccess: (result) => {
      if (result.etag) queryClient.setQueryData(PROFILE_KEY, result);
      else void queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.AUTH.ME] });
    },
  });
};
