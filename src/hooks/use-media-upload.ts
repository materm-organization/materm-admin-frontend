"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { checkFile, matchesAccept } from "@/lib/media-upload";
import { UploadQueue, type UploadItem } from "@/lib/media-upload-queue";
import { MediaAPI } from "@/services/media.api";

const EMPTY: readonly UploadItem[] = [];

// The upload queue of one open dialog. `folderId` is read when a file STARTS (so a change of folder applies to the
// files still waiting). `allowSvg` = the user has `media.library:update`. When the queue goes idle after work the
// library list and folder counts are refreshed (FR-MEDIA-01: the list shows the new files without a reload).
// `accept` (the media picker): files outside that mime list fail the client check and are never sent.
export function useMediaUpload({ folderId, allowSvg, accept }: { folderId: number | null; allowSvg: boolean; accept?: string }) {

  const queryClient = useQueryClient();
  const queue = useMemo(
    () =>
      new UploadQueue({
        upload: (file, { allowDuplicate, signal, onProgress, context }) =>
          MediaAPI.UploadFile(file, { folderId: context.folderId, allowDuplicate, signal, onProgress }),
        precheck: (file, context) =>
          matchesAccept(file, context.accept)
            ? checkFile(file, { allowSvg: context.allowSvg })
            : { kind: "notAccepted" as const, retryable: false },
      }),
    []
  );
  useEffect(() => {
    queue.setContext({ folderId, allowSvg, accept });
  }, [queue, folderId, allowSvg, accept]);
  useEffect(() => () => queue.reset(), [queue]);

  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => EMPTY);
  const busy = items.some((i) => i.status === "queued" || i.status === "uploading");

  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MEDIA.ASSETS] });
      void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MEDIA.FOLDERS] });
      void queryClient.invalidateQueries({ queryKey: ["schema-form", "media-list"] });
    }
    wasBusy.current = busy;
  }, [busy, queryClient]);

  return { queue, items, busy };
}
