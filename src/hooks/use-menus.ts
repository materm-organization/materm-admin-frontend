import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import type { WithEtag } from "@/lib/etag";
import { revisionsQueryKey } from "@/lib/revision-resources";
import { MenusAPI } from "@/services/menus.api";
import type { ApiResponse } from "@/types/api";
import type {
  CreateMenuItemPayload,
  MenuDetail,
  MenuItem,
  MenuStamp,
  ReorderMenuItemsPayload,
  UpdateMenuItemPayload,
} from "@/types/menus";

export const menuQueryKey = (key: string) => [API_ENDPOINTS.MENUS.DETAIL(key)] as const;
const MENU_LIST_KEY = [API_ENDPOINTS.MENUS.LIST] as const;

// SCR-17: the three system menus (not paginated).
export const useMenus = (enabled = true) =>
  useQuery({ queryKey: MENU_LIST_KEY, queryFn: () => MenusAPI.List(), enabled });

// SCR-18: one menu with its items and the ETag every write sends as `If-Match`.
export const useMenu = (key: string, enabled = true) =>
  useQuery({ queryKey: menuQueryKey(key), queryFn: () => MenusAPI.Get(key), enabled });

type Cached = WithEtag<ApiResponse<MenuDetail>>;

// A write answers the item / order and the menu's NEW stamp: apply it to the cached menu and keep the new ETag
// (a refetch would only tell the same, and the next write would be sent with a stale `If-Match` until it came).
function writeThrough(queryClient: QueryClient, key: string, stamp: MenuStamp, change: (items: MenuItem[]) => MenuItem[]) {
  queryClient.setQueryData<Cached>(menuQueryKey(key), (old) => {
    if (!old) return old;
    const items = change(old.data.data.items)
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    return {
      etag: stamp.etag,
      data: {
        ...old.data,
        data: {
          ...old.data.data,
          items,
          etag: stamp.etag,
          updated_at: stamp.updated_at,
          item_count: stamp.item_count,
          visible_item_count: items.filter((i) => i.is_visible && i.link_state === "ok").length,
        },
      },
    };
  });
  void queryClient.invalidateQueries({ queryKey: MENU_LIST_KEY });
  void queryClient.invalidateQueries({ queryKey: revisionsQueryKey("menus", key) });
}

export const useMutationCreateMenuItem = (key: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, etag, idempotencyKey }: { payload: CreateMenuItemPayload; etag: string | undefined; idempotencyKey?: string }) =>
      MenusAPI.CreateItem(key, payload, etag, idempotencyKey),
    onSuccess: (result) => {
      const { item, menu } = result.data.data;
      // The server renumbered the siblings from the position of the new item; refetch to learn their `sort_order`.
      writeThrough(queryClient, key, { ...menu, etag: result.etag ?? menu.etag }, (items) => {
        const shifted = items.map((i) => (i.sort_order >= item.sort_order ? { ...i, sort_order: i.sort_order + 1 } : i));
        return [...shifted, item];
      });
    },
  });
};

export const useMutationUpdateMenuItem = (key: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload, etag }: { id: number; payload: UpdateMenuItemPayload; etag: string | undefined }) =>
      MenusAPI.UpdateItem(key, id, payload, etag),
    onSuccess: (result) => {
      const { item, menu } = result.data.data;
      // A `position` change renumbers the others on the server: refetch the order from the same stamp.
      writeThrough(queryClient, key, { ...menu, etag: result.etag ?? menu.etag }, (items) => items.map((i) => (i.id === item.id ? item : i)));
    },
  });
};

export const useMutationReorderMenuItems = (key: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, etag }: { payload: ReorderMenuItemsPayload; etag: string | undefined }) =>
      MenusAPI.ReorderItems(key, payload, etag),
    onSuccess: (result) => {
      const { items: order, menu } = result.data.data;
      writeThrough(queryClient, key, { ...menu, etag: result.etag ?? menu.etag }, (items) =>
        items.map((i) => {
          const o = order.find((x) => x.id === i.id);
          return o ? { ...i, sort_order: o.sort_order } : i;
        })
      );
    },
  });
};

export const useMutationDeleteMenuItem = (key: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, etag }: { id: number; etag: string | undefined }) => MenusAPI.DeleteItem(key, id, etag).then((r) => ({ ...r, id })),
    onSuccess: (result) => {
      const { menu } = result.data.data;
      writeThrough(queryClient, key, { ...menu, etag: result.etag ?? menu.etag }, (items) => items.filter((i) => i.id !== result.id));
    },
  });
};
