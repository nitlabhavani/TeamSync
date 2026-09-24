import { useRef, useState, useEffect } from "react";
import { Paperclip, Send, X, FileText, Loader2, Mic, Smile, Image as ImageIcon, Video as VideoIcon } from "lucide-react";
import { useFileUpload } from "../../hooks/useFileUpload";
import { useVoiceRecorder } from "../../hooks/useVoiceRecorder";
import * as fileService from "../../services/fileService";
import { MAX_FILE_SIZE_MB } from "../../utils/constants";
import { formatFileSize } from "../../utils/helperFunctions";
import VoiceRecorderBar from "./VoiceRecorderBar";
import EmojiPicker from "./EmojiPicker";

/**
 * ChatInput component supporting:
 *  - Group chat file attachments (via /groups/:groupId/files)
 *  - Private chat file attachments (via /chat/direct/:userId/files)
 *  - Private voice recording (via /chat/direct/:userId/voice)
 *  - Private media sharing: photos and videos with preview before send (via /chat/direct/:userId/media)
 *  - Private emoji picker for easy insertion into text (including emoji-only messages)
 */
const ChatInput = ({ onSend, onTyping, placeholder = "Type a message", groupId, peerUserId, currentUserId, scope }) => {
  const [value, setValue] = useState("");
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingMedia, setPendingMedia] = useState(null); // { file, type: 'image' | 'video', previewUrl }
  const [mediaUploading, setMediaUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const fileRef = useRef(null);
  const photoRef = useRef(null);
  const videoRef = useRef(null);
  const textareaRef = useRef(null);

  const canAttach = !!(groupId || peerUserId);
  const isDirect = scope === "direct" && !!peerUserId;
  const canRecordVoice = isDirect && !!currentUserId;

  const { upload, uploading, progress } = useFileUpload(groupId, currentUserId, peerUserId);
  const recorder = useVoiceRecorder();
  const [voiceSending, setVoiceSending] = useState(false);
  const [voiceError, setVoiceError] = useState("");

  // Clean up media preview URL on unmount
  useEffect(() => {
    return () => {
      if (pendingMedia?.previewUrl) {
        URL.revokeObjectURL(pendingMedia.previewUrl);
      }
    };
  }, [pendingMedia]);

  const clearAttachment = () => {
    setPendingFile(null);
    setUploadError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const clearMedia = () => {
    if (pendingMedia?.previewUrl) {
      URL.revokeObjectURL(pendingMedia.previewUrl);
    }
    setPendingMedia(null);
    setUploadError("");
    if (photoRef.current) photoRef.current.value = "";
    if (videoRef.current) videoRef.current.value = "";
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError("");
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setUploadError(`"${file.name}" is over ${MAX_FILE_SIZE_MB}MB.`);
      return;
    }
    clearMedia();
    setPendingFile(file);
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError("");
    if (file.size > 15 * 1024 * 1024) {
      setUploadError(`Photo "${file.name}" exceeds the 15MB limit.`);
      return;
    }
    clearAttachment();
    const previewUrl = URL.createObjectURL(file);
    setPendingMedia({ file, type: "image", previewUrl });
  };

  const handleVideoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError("");
    if (file.size > 50 * 1024 * 1024) {
      setUploadError(`Video "${file.name}" exceeds the 50MB limit.`);
      return;
    }
    clearAttachment();
    const previewUrl = URL.createObjectURL(file);
    setPendingMedia({ file, type: "video", previewUrl });
  };

  const handleSelectEmoji = (emoji) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setValue((prev) => prev + emoji);
      return;
    }
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    const updated = value.substring(0, start) + emoji + value.substring(end);
    setValue(updated);
    setTimeout(() => {
      textarea.focus();
      const nextPos = start + emoji.length;
      textarea.setSelectionRange(nextPos, nextPos);
    }, 0);
  };

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed && !pendingFile && !pendingMedia) return;
    if (uploading || mediaUploading) return;

    let attachments = [];

    // 1. Regular file attachment
    if (pendingFile) {
      try {
        setUploadError("");
        const saved = await upload(pendingFile);
        attachments = [
          {
            name: saved.originalName || saved.name,
            url: saved.url,
            size: saved.size,
            type: saved.type,
            mimeType: saved.mimeType,
          },
        ];
        clearAttachment();
      } catch (err) {
        setUploadError(err.message || "File upload failed. Please try again.");
        return;
      }
    }

    // 2. Direct media attachment (Photo or Video)
    if (pendingMedia) {
      try {
        setMediaUploading(true);
        setUploadError("");
        const saved = await fileService.uploadDirectMedia({
          peerUserId,
          file: pendingMedia.file,
        });
        attachments = [
          {
            name: saved.name || (pendingMedia.type === "video" ? "Video" : "Photo"),
            url: saved.url,
            size: saved.size,
            type: saved.type || pendingMedia.type,
            mimeType: saved.mimeType,
          },
        ];
        clearMedia();
      } catch (err) {
        setUploadError(err.message || "Media upload failed. Please try again.");
        setMediaUploading(false);
        return;
      } finally {
        setMediaUploading(false);
      }
    }

    setValue("");
    try {
      await onSend?.(trimmed, attachments);
    } catch (err) {
      setUploadError(err.message || "Message failed to send. Please try again.");
    }
  };

  const submitVoice = async () => {
    if (!recorder.blob || voiceSending) return;
    setVoiceSending(true);
    setVoiceError("");
    try {
      const saved = await fileService.uploadDirectVoice({
        peerUserId,
        blob: recorder.blob,
        mimeType: recorder.mimeType,
        duration: recorder.elapsedSeconds,
      });
      const attachment = {
        name: saved.name || "Voice message",
        url: saved.url,
        size: saved.size,
        type: saved.type || "audio",
        mimeType: saved.mimeType,
        duration: saved.duration,
      };
      recorder.reset();
      await onSend?.("", [attachment]);
    } catch (err) {
      setVoiceError(err.message || "Couldn't send the voice message. Please try again.");
    } finally {
      setVoiceSending(false);
    }
  };

  const isRecordingUi = canRecordVoice && (recorder.status === "recording" || recorder.status === "preview");

  return (
    <div className="border-t border-slate-line bg-paper px-3 sm:px-5 py-3">
      <div className="max-w-3xl mx-auto">
        {/* Pending document file preview */}
        {pendingFile && (
          <div className="flex items-center gap-2 bg-cloud border border-slate-line rounded-xl px-3 py-2 mb-2 text-xs">
            <FileText className="w-4 h-4 text-brand shrink-0" />
            <span className="min-w-0 flex-1 truncate font-medium text-slate-ink">{pendingFile.name}</span>
            <span className="text-slate-muted shrink-0">{formatFileSize(pendingFile.size)}</span>
            {uploading ? (
              <span className="flex items-center gap-1 text-slate-muted shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {progress}%
              </span>
            ) : (
              <button
                onClick={clearAttachment}
                aria-label="Remove attachment"
                className="text-slate-muted hover:text-coral shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Pending Photo / Video preview before send */}
        {pendingMedia && (
          <div className="flex items-center gap-3 bg-cloud border border-slate-line rounded-xl p-2.5 mb-2 text-xs animate-in fade-in duration-100">
            {pendingMedia.type === "image" ? (
              <img
                src={pendingMedia.previewUrl}
                alt="Preview"
                className="w-12 h-12 rounded-lg object-cover border border-slate-line shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-brand-soft/60 flex items-center justify-center shrink-0">
                <VideoIcon className="w-6 h-6 text-brand" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-ink truncate">{pendingMedia.file.name}</p>
              <p className="text-[11px] text-slate-muted">
                {pendingMedia.type === "image" ? "Photo preview" : "Video preview"} · {formatFileSize(pendingMedia.file.size)}
              </p>
            </div>
            {mediaUploading ? (
              <span className="flex items-center gap-1 text-slate-muted shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" /> Uploading...
              </span>
            ) : (
              <button
                type="button"
                onClick={clearMedia}
                aria-label="Remove media preview"
                className="text-slate-muted hover:text-coral p-1 rounded-md hover:bg-paper transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {uploadError && <p className="text-xs text-coral mb-2">{uploadError}</p>}
        {canRecordVoice && recorder.status === "error" && (
          <p className="text-xs text-coral mb-2">{recorder.errorMessage}</p>
        )}

        {isRecordingUi ? (
          <VoiceRecorderBar
            recorder={recorder}
            onDiscard={recorder.discardRecording}
            onSend={submitVoice}
            sending={voiceSending}
            uploadError={voiceError}
          />
        ) : (
          <div className="flex items-end gap-1 sm:gap-1.5 relative">
            {/* Direct-chat-only Emoji picker */}
            {isDirect && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker((prev) => !prev)}
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-full hover:bg-cloud flex items-center justify-center text-slate-muted hover:text-amber-500 shrink-0 transition-colors"
                  aria-label="Choose emoji"
                  title="Insert emoji"
                >
                  <Smile className="w-4 h-4 sm:w-[19px] sm:h-[19px]" />
                </button>
                {showEmojiPicker && (
                  <EmojiPicker
                    onSelect={handleSelectEmoji}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                )}
              </div>
            )}

            {/* Attach Document button */}
            <button
              onClick={() => (canAttach ? fileRef.current?.click() : undefined)}
              disabled={!canAttach || uploading || mediaUploading}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full hover:bg-cloud flex items-center justify-center text-slate-muted hover:text-brand shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Attach a file"
              title={canAttach ? "Attach a file" : undefined}
            >
              <Paperclip className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
            </button>
            <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} aria-hidden="true" tabIndex={-1} />

            {/* Direct-chat-only Photo & Video attachment buttons */}
            {isDirect && (
              <>
                <button
                  type="button"
                  onClick={() => photoRef.current?.click()}
                  disabled={uploading || mediaUploading}
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-full hover:bg-cloud flex items-center justify-center text-slate-muted hover:text-brand shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label="Share photo"
                  title="Share photo"
                >
                  <ImageIcon className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                </button>
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoChange}
                  aria-hidden="true"
                  tabIndex={-1}
                />

                <button
                  type="button"
                  onClick={() => videoRef.current?.click()}
                  disabled={uploading || mediaUploading}
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-full hover:bg-cloud flex items-center justify-center text-slate-muted hover:text-brand shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label="Share video"
                  title="Share video"
                >
                  <VideoIcon className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                </button>
                <input
                  ref={videoRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={handleVideoChange}
                  aria-hidden="true"
                  tabIndex={-1}
                />
              </>
            )}

            {/* Direct-chat-only Voice message recorder button */}
            {canRecordVoice && (
              <button
                onClick={recorder.startRecording}
                disabled={uploading || mediaUploading || recorder.status === "requesting"}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full hover:bg-cloud flex items-center justify-center text-slate-muted hover:text-brand shrink-0 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand/40 transition-colors"
                aria-label="Record a voice message"
                title="Record a voice message"
              >
                {recorder.status === "requesting" ? (
                  <Loader2 className="w-4 h-4 sm:w-[18px] sm:h-[18px] animate-spin text-brand" />
                ) : (
                  <Mic className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                )}
              </button>
            )}

            {/* Message Textarea */}
            <div className="flex-1 flex items-end bg-cloud rounded-2xl px-2.5 py-2 sm:px-3.5 sm:py-2.5 min-w-0">
              <textarea
                ref={textareaRef}
                rows={1}
                value={value}
                placeholder={placeholder}
                aria-label="Message"
                onChange={(e) => {
                  setValue(e.target.value);
                  onTyping?.();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                className="flex-1 bg-transparent text-sm outline-none resize-none max-h-28 placeholder:text-slate-muted min-w-0"
              />
            </div>

            {/* Send Button */}
            <button
              onClick={submit}
              disabled={(!value.trim() && !pendingFile && !pendingMedia) || uploading || mediaUploading}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-brand disabled:bg-slate-line disabled:cursor-not-allowed flex items-center justify-center shrink-0 transition-colors"
              aria-label="Send message"
            >
              {uploading || mediaUploading ? (
                <Loader2 className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-white animate-spin" />
              ) : (
                <Send className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-white" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
