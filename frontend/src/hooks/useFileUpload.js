import { useCallback, useState } from "react";
import * as fileService from "../services/fileService";

/**
 * `peerUserId` (new) enables file attachments in PRIVATE/direct chat: when
 * there is no `groupId` but a `peerUserId` is supplied, `upload()` calls
 * fileService.uploadDirectFile (the new /chat/direct/:userId/files
 * endpoint) instead of the group-scoped fileService.uploadFile — so a
 * private attachment is never written into a group's upload folder or
 * FileAsset collection. Existing group-chat/Shared-Files call sites that
 * only ever pass `groupId` are completely unaffected.
 */
export const useFileUpload = (groupId, uploadedBy, peerUserId) => {
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = useCallback(
    async (file) => {
      setUploading(true);
      setError("");
      setProgress(0);
      try {
        const saved = groupId
          ? await fileService.uploadFile({ groupId, file, uploadedBy, onProgress: setProgress })
          : await fileService.uploadDirectFile({ peerUserId, file, onProgress: setProgress });
        return saved;
      } catch (err) {
        setError(err.message || "Upload failed.");
        throw err;
      } finally {
        setUploading(false);
      }
    },
    [groupId, uploadedBy, peerUserId],
  );

  const uploadMany = useCallback(
    async (files) => {
      setUploading(true);
      setError("");
      setProgress(0);
      try {
        const saved = await fileService.uploadFiles({
          groupId,
          files,
          onProgress: setProgress,
        });
        return saved;
      } catch (err) {
        setError(err.message || "Upload failed.");
        throw err;
      } finally {
        setUploading(false);
      }
    },
    [groupId],
  );

  return { upload, uploadMany, progress, uploading, error };
};
