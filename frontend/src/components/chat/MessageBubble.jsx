import { useState, useEffect } from "react";
import { getInitials, classNames, formatFileSize } from "../../utils/helperFunctions";
import { formatTime } from "../../utils/dateFormatter";
import { Check, CheckCheck, Clock, Trash2, Paperclip, Download, Loader2, X } from "lucide-react";
import { api } from "../../lib/apiClient";
import AudioMessage from "./AudioMessage";

/**
 * Checks whether text consists exclusively of emojis (and whitespace).
 */
const isEmojiOnly = (text) => {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  const emojiRegex = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\s|[\u200d\ufe0e\ufe0f\ud83c\udffb-\ud83c\udfff])+$/u;
  return emojiRegex.test(trimmed);
};

const AttachmentRow = ({ attachment, isOwn }) => (
  <a
    href={attachment.url}
    target="_blank"
    rel="noopener noreferrer"
    download={attachment.name}
    className={classNames(
      "flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs no-underline transition-colors",
      isOwn ? "bg-white/15 hover:bg-white/20 text-white" : "bg-cloud hover:bg-slate-line/60 text-slate-ink"
    )}
  >
    <Paperclip className="w-3.5 h-3.5 shrink-0" />
    <span className="min-w-0 flex-1 truncate font-medium">{attachment.name}</span>
    {!!attachment.size && (
      <span className={classNames("shrink-0", isOwn ? "text-white/70" : "text-slate-muted")}>
        {formatFileSize(attachment.size)}
      </span>
    )}
    <Download className="w-3.5 h-3.5 shrink-0" aria-label="Download" />
  </a>
);

/** Authenticated photo viewer with Lightbox modal */
const MediaImage = ({ attachment, isOwn }) => {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    let active = true;
    let createdUrl = null;
    const load = async () => {
      try {
        setLoading(true);
        const blob = await api.getBlob(attachment.url);
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment.url]);

  if (loading) {
    return (
      <div className="w-48 sm:w-56 h-36 rounded-xl bg-slate-line/30 flex items-center justify-center animate-pulse">
        <Loader2 className="w-5 h-5 text-slate-muted animate-spin" />
      </div>
    );
  }

  if (error || !blobUrl) {
    return <AttachmentRow attachment={attachment} isOwn={isOwn} />;
  }

  return (
    <>
      <div className="relative group/media overflow-hidden rounded-xl max-w-sm">
        <img
          src={blobUrl}
          alt={attachment.name || "Photo"}
          onClick={() => setLightbox(true)}
          className="max-h-64 max-w-full rounded-xl object-cover cursor-pointer hover:opacity-95 transition-opacity"
        />
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setLightbox(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <img
              src={blobUrl}
              alt={attachment.name || "Photo"}
              className="max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl"
            />
            <div className="mt-2 flex items-center gap-3 text-white text-xs">
              <span className="truncate max-w-xs">{attachment.name}</span>
              <a
                href={blobUrl}
                download={attachment.name || "photo.jpg"}
                className="inline-flex items-center gap-1 rounded bg-white/20 px-2.5 py-1 hover:bg-white/30 transition-colors text-white"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </a>
              <button
                onClick={() => setLightbox(false)}
                className="p-1 rounded bg-white/20 hover:bg-white/30 text-white transition-colors"
                aria-label="Close lightbox"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/** Authenticated video player with controls (no autoplay) */
const MediaVideo = ({ attachment, isOwn }) => {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let createdUrl = null;
    const load = async () => {
      try {
        setLoading(true);
        const blob = await api.getBlob(attachment.url);
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment.url]);

  if (loading) {
    return (
      <div className="w-56 sm:w-64 h-40 rounded-xl bg-slate-line/30 flex items-center justify-center animate-pulse">
        <Loader2 className="w-5 h-5 text-slate-muted animate-spin" />
      </div>
    );
  }

  if (error || !blobUrl) {
    return <AttachmentRow attachment={attachment} isOwn={isOwn} />;
  }

  return (
    <div className="rounded-xl overflow-hidden bg-black max-w-sm">
      <video
        src={blobUrl}
        controls
        preload="metadata"
        playsInline
        className="max-h-72 w-full rounded-xl"
      />
    </div>
  );
};

const MessageBubble = ({ message, isOwn, sender, showSenderName, onDelete, readByOthers, highlighted = false }) => {
  const seen = readByOthers ?? (message.readBy || []).length > 1;
  const attachments = message.attachments || [];

  const voiceAttachment = message.type === "voice" ? attachments.find((a) => a.type === "audio") : null;
  const imageAttachments = attachments.filter((a) => a.type === "image" || a.mimeType?.startsWith("image/"));
  const videoAttachments = attachments.filter((a) => a.type === "video" || a.mimeType?.startsWith("video/"));
  const fileAttachments = attachments.filter(
    (a) =>
      a.type !== "audio" &&
      a.type !== "image" &&
      a.type !== "video" &&
      !a.mimeType?.startsWith("image/") &&
      !a.mimeType?.startsWith("video/")
  );

  const isEmoji = !attachments.length && isEmojiOnly(message.text);

  return (
    <div className={classNames("group flex items-end gap-2.5 mb-3.5", isOwn ? "flex-row-reverse" : "flex-row")}>
      {!isOwn && (
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
          style={{ backgroundColor: sender?.color || "#5B5FEF" }}
        >
          {getInitials(sender?.name || "?")}
        </span>
      )}

      <div
        className={classNames(
          "relative max-w-[85%] sm:max-w-[70%] transition-shadow duration-300",
          isEmoji
            ? "px-1 py-0.5 bg-transparent"
            : isOwn
            ? "bg-brand text-white rounded-2xl rounded-br-sm px-3.5 py-2.5"
            : "bg-paper text-slate-ink rounded-2xl rounded-bl-sm border border-slate-line shadow-sm px-3.5 py-2.5",
          highlighted && "ring-2 ring-offset-2 ring-amber-400"
        )}
      >
        {showSenderName && !isOwn && !isEmoji && (
          <p className="text-[11px] font-semibold mb-0.5" style={{ color: sender?.color }}>
            {sender?.name}
          </p>
        )}

        {voiceAttachment ? (
          <AudioMessage attachment={voiceAttachment} isOwn={isOwn} />
        ) : (
          <>
            {/* Photos */}
            {imageAttachments.length > 0 && (
              <div className="space-y-2 mb-2">
                {imageAttachments.map((att, i) => (
                  <MediaImage key={att.url || i} attachment={att} isOwn={isOwn} />
                ))}
              </div>
            )}

            {/* Videos */}
            {videoAttachments.length > 0 && (
              <div className="space-y-2 mb-2">
                {videoAttachments.map((att, i) => (
                  <MediaVideo key={att.url || i} attachment={att} isOwn={isOwn} />
                ))}
              </div>
            )}

            {/* Message Text */}
            {!!message.text && (
              <p
                className={classNames(
                  "whitespace-pre-wrap break-words",
                  isEmoji
                    ? "text-3xl sm:text-4xl py-1 leading-normal select-none"
                    : "text-sm leading-relaxed"
                )}
              >
                {message.text}
              </p>
            )}

            {/* Documents / files */}
            {fileAttachments.length > 0 && (
              <div className={classNames("space-y-1.5", message.text ? "mt-2" : "")}>
                {fileAttachments.map((att, i) => (
                  <AttachmentRow key={att.url || i} attachment={att} isOwn={isOwn} />
                ))}
              </div>
            )}
          </>
        )}

        <div className={classNames("flex items-center gap-1 mt-1", isOwn ? "justify-end" : "justify-start")}>
          <span className={classNames("text-[10px]", isEmoji ? "text-slate-muted" : isOwn ? "text-white/70" : "text-slate-muted")}>
            {formatTime(message.time)}
          </span>
          {isOwn &&
            (message.pending ? (
              <Clock className={classNames("w-3 h-3", isEmoji ? "text-slate-muted" : "text-white/70")} />
            ) : seen ? (
              <CheckCheck className={classNames("w-3 h-3", isEmoji ? "text-brand" : "text-white")} aria-label="Read" />
            ) : (
              <Check className={classNames("w-3 h-3", isEmoji ? "text-slate-muted" : "text-white/60")} aria-label="Sent" />
            ))}
        </div>
      </div>

      {isOwn && onDelete && !message.pending && (
        <button
          onClick={() => onDelete(message)}
          aria-label="Delete message"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity w-7 h-7 rounded-full hover:bg-coral-soft flex items-center justify-center text-slate-muted hover:text-coral"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export default MessageBubble;
