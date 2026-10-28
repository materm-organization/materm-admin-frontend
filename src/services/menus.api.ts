import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { ifMatch, withEtag } from "@/lib/etag";
import { idempotencyKeyHeaders } from "@/lib/idempotency";
import type { ApiResponse } from "@/types/api";
import type {
  CreateMenuItemPayload,
  MenuDeleteResult,
  MenuDetail,
  MenuItemWriteResult,
  MenuOrderResult,
  MenuSummary,
  ReorderMenuItemsPayload,
  UpdateMenuItemPayload,
} from "@/types/menus";

// Menus (doc/05 section 11.2). Every write of an item needs `If-Match` = the menu's ETag (428 without it) and
// answers the menu's NEW ETag in `data.menu.etag` and in the `ETag` header: keep it, do not refetch.
export const MenusAPI = {
  // Not paginated (three system menus).
  List: async () => {
    const { data } = await axiosInstance.get<ApiResponse<MenuSummary[]>>(API_ENDPOINTS.MENUS.LIST);
    return data;
  },
  Get: async (key: string) =>
    withEtag(await axiosInstance.get<ApiResponse<MenuDetail>>(API_ENDPOINTS.MENUS.DETAIL(key))),
  // `Idempotency-Key` is opt-in on this POST (11.1.5): once per dialog / form open.
  CreateItem: async (key: string, payload: CreateMenuItemPayload, etag: string | undefined, idempotencyKey?: string) =>
    withEtag(
      await axiosInstance.post<ApiResponse<MenuItemWriteResult>>(API_ENDPOINTS.MENUS.ITEMS(key), payload, {
        headers: { ...ifMatch(etag, { required: true }).headers, ...idempotencyKeyHeaders(idempotencyKey) },
      })
    ),
  UpdateItem: async (key: string, id: number, payload: UpdateMenuItemPayload, etag: string | undefined) =>
    withEtag(
      await axiosInstance.patch<ApiResponse<MenuItemWriteResult>>(
        API_ENDPOINTS.MENUS.ITEM(key, id),
        payload,
        ifMatch(etag, { required: true })
      )
    ),
  // The whole menu in one request (all-or-nothing): the ids must be exactly the current ones.
  ReorderItems: async (key: string, payload: ReorderMenuItemsPayload, etag: string | undefined) =>
    withEtag(
      await axiosInstance.put<ApiResponse<MenuOrderResult>>(
        API_ENDPOINTS.MENUS.ITEMS_ORDER(key),
        payload,
        ifMatch(etag, { required: true })
      )
    ),
  DeleteItem: async (key: string, id: number, etag: string | undefined) =>
    withEtag(
      await axiosInstance.delete<ApiResponse<MenuDeleteResult>>(API_ENDPOINTS.MENUS.ITEM(key, id), ifMatch(etag, { required: true }))
    ),
};
