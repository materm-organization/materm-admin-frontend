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
  Me: async () => {
    const { data } = await axiosInstance.get<ApiResponse<CurrentUser>>(
      API_ENDPOINTS.AUTH.ME
    );
    return data;
  },
  // POST, not PUT — the backend route is
  // `users.Post("/change-password", ...)` (user_routes.go), not a PUT.
  ChangePassword: async (payload: ChangePasswordPayload) => {
    const { data } = await axiosInstance.post<ApiResponse<string>>(
      API_ENDPOINTS.AUTH.CHANGE_PASSWORD,
      payload
    );
    return data;
  },
};
