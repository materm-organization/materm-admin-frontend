import { axiosInstance, axiosPublicInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, withEtag } from "@/lib/etag";
import { ApiResponse } from "@/types/api";
import {
  AcceptInvitationPayload,
  ChangePasswordPayload,
  CurrentUser,
  ForgotPasswordPayload,
  InvitationVerifyResult,
  LoginPayload,
  LoginResponse,
  ResetPasswordPayload,
  UpdateProfilePayload,
  UserProfile,
} from "@/types/user";

export const AuthAPI = {
  // Login goes through the public instance — there's no token yet to attach.
  Login: async (payload: LoginPayload) => {
    const { data } = await axiosPublicInstance.post<ApiResponse<LoginResponse>>(
      API_ENDPOINTS.AUTH.LOGIN,
      payload
    );
    return data;
  },
  // POST /auth/logout revokes the session family. A 401 means the session is
  // already gone — callers treat that as signed out. `skipSessionRedirect`:
  // the caller clears the session itself, so the 401 interceptor must not
  // redirect or leave a "session ended" notice.
  Logout: async () => {
    const { data } = await axiosInstance.post<ApiResponse<null>>(
      API_ENDPOINTS.AUTH.LOGOUT,
      undefined,
      { skipSessionRedirect: true, timeout: 8000 }
    );
    return data;
  },
  Me: async () => {
    const { data } = await axiosInstance.get<ApiResponse<CurrentUser>>(
      API_ENDPOINTS.AUTH.ME
    );
    return data;
  },
  // POST /auth/users/change-password — allowed even while
  // `must_change_password` is true (it is the way out of that state).
  ChangePassword: async (payload: ChangePasswordPayload) => {
    const { data } = await axiosInstance.post<ApiResponse<string>>(
      API_ENDPOINTS.AUTH.CHANGE_PASSWORD,
      payload
    );
    return data;
  },

  // --- Public self-service calls: the PUBLIC instance, so a visitor who is still signed in does not send their
  // Bearer token and a 401 can never trigger the refresh / sign-out logic. Tokens go in the BODY, never in a URL.
  // Always 200 (neutral), whether or not the account exists (doc/05 section 2.6).
  ForgotPassword: async (payload: ForgotPasswordPayload) => {
    const { data } = await axiosPublicInstance.post<ApiResponse<null>>(
      API_ENDPOINTS.AUTH.FORGOT_PASSWORD,
      payload
    );
    return data;
  },
  ResetPassword: async (payload: ResetPasswordPayload) => {
    const { data } = await axiosPublicInstance.post<ApiResponse<null>>(
      API_ENDPOINTS.AUTH.RESET_PASSWORD,
      payload
    );
    return data;
  },
  VerifyInvitation: async (token: string) => {
    const { data } = await axiosPublicInstance.post<ApiResponse<InvitationVerifyResult>>(
      API_ENDPOINTS.AUTH.INVITATION_VERIFY,
      { token }
    );
    return data;
  },
  // The answer is a TokenPair like /login (the invitee is signed in at once).
  AcceptInvitation: async (payload: AcceptInvitationPayload) => {
    const { data } = await axiosPublicInstance.post<ApiResponse<LoginResponse>>(
      API_ENDPOINTS.AUTH.INVITATION_ACCEPT,
      payload
    );
    return data;
  },
  // Fire-and-forget sign-out of an OLD session with an explicit token (accepting an invite while signed in as
  // someone else). Never rejects.
  RevokeSessionQuietly: async (accessToken: string) => {
    try {
      await axiosPublicInstance.post(API_ENDPOINTS.AUTH.LOGOUT, undefined, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 8000,
      });
    } catch {
      /* best effort */
    }
  },

  // --- Own profile (SCR-06). `{ data, etag }`: the ETag goes back as `If-Match` (recommended, not mandatory).
  GetProfile: async () => withEtag(await axiosInstance.get<ApiResponse<UserProfile>>(API_ENDPOINTS.AUTH.PROFILE)),
  UpdateProfile: async (payload: UpdateProfilePayload, etag?: string) =>
    withEtag(
      await axiosInstance.patch<ApiResponse<UserProfile>>(API_ENDPOINTS.AUTH.PROFILE, payload, ifMatch(etag))
    ),
};
