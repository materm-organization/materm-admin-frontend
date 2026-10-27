import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { ApiResponse, ApiResponsePagination } from "@/types/api";
import type {
  CreateUserPayload,
  CreateUserResult,
  RoleSummary,
  User,
  UsersListParams,
} from "@/types/iam";

export const UsersAPI = {
  List: async (params: UsersListParams) => {
    const { data } = await axiosInstance.get<ApiResponsePagination<User[]>>(
      API_ENDPOINTS.USERS.LIST,
      { params: { page: params.page, limit: params.limit, keyword: params.keyword || undefined } }
    );
    return data;
  },
  // POST /users with delivery=temporary_password. The response carries the
  // temporary password ONCE — pass it to the dialog, never store or log it.
  Create: async (payload: CreateUserPayload) => {
    const { data } = await axiosInstance.post<ApiResponse<CreateUserResult>>(
      API_ENDPOINTS.USERS.CREATE,
      payload
    );
    return data;
  },
};

export const RolesAPI = {
  // Role choices for the user form (needs iam.roles:read OR iam.users:read).
  List: async () => {
    const { data } = await axiosInstance.get<ApiResponsePagination<RoleSummary[]>>(
      API_ENDPOINTS.ROLES.LIST,
      { params: { limit: 100 } }
    );
    return data;
  },
};
