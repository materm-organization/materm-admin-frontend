import { axiosInstance, axiosPublicInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ApiResponse } from "@/types/api";
import {
  ChangePasswordPayload,
  CurrentUser,
  LoginPayload,
  LoginResponse,
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
};
