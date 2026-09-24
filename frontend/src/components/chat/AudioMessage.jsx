import { useEffect, useRef, useState } from "react";
import { Play, Pause, Loader2, AlertCircle, Mic } from "lucide-react";
import { api } from "../../lib/apiClient";
import { formatDuration, classNames } from "../../utils/helperFunctions";
import { audioPlaybackManager } from "../../utils/audioPlaybackManager";

/**
 * PRIVATE VOICE MESSAGES — playback bubble for a message with
 * `message.type === "voice"`.
 *
 * Real audio features:
 *  - Single-playback guarantee: only one voice message can play at a time.
 *    Starting playback here automatically pauses any other active voice message.
 *  - Interactive click-to-seek & scrubbing on the progress bar with keyboard support.
 *  - Nothing is fetched until user presses Play (no autoplay).
 *  - Fetched once, authenticated via api.getBlob() with Bearer token.
 *  - Duration uses server-recorded duration until metadata is loaded.
 *  - Full cleanup of object URLs and audio coordinator registration on unmount.
 */
const AudioMessage = ({ attachment, isOwn }) => {
  const audioRef = useRef(null);
  const objectUrlRef = useRef(null);
  const progressBarRef = useRef(null);
  const [state, setState] = useState("idle"); // idle | loading | ready | error
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(attachment?.duration || 0);
  const [errorMsg, setErrorMsg] = useState("");

  const instanceId = attachment?.url || String(Math.random());

  useEffect(() => {
    return () => {
      // Release the fetched clip's object URL when this bubble unmounts
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      audioPlaybackManager.pause(instanceId);
    };
  }, [instanceId]);

  const ensureLoaded = async () => {
    if (state === "ready" || state === "loading") return true;
    setState("loading");
    setErrorMsg("");
    try {
      const blob = await api.getBlob(attachment.url);
      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      if (audioRef.current) audioRef.current.src = objectUrl;
      setState("ready");
      return true;
    } catch (err) {
      setState("error");
      setErrorMsg(err?.message || "Couldn't load this voice message.");
      return false;
    }
  };

  const handleTogglePlay = async () => {
    if (state === "error") {
      // Explicit retry — do not keep failing silently.
      const ok = await ensureLoaded();
      if (ok) {
        audioRef.current?.play().catch(() => setErrorMsg("Couldn't play this voice message."));
      }
      return;
    }
    if (playing) {
      audioRef.current?.pause();
      return;
    }
    const ok = state === "ready" || (await ensureLoaded());
    if (ok) {
      try {
        await audioRef.current?.play();
      } catch {
        setErrorMsg("Couldn't play this voice message.");
        setState("error");
      }
    }
  };

  const handleSeek = (e) => {
    if (!audioRef.current || !duration || duration <= 0) return;
    const rect = progressBarRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const targetTime = (clickX / rect.width) * duration;
    audioRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const handleKeyDown = (e) => {
    if (!audioRef.current || !duration || duration <= 0) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const targetTime = Math.max(0, currentTime - 5);
      audioRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const targetTime = Math.min(duration, currentTime + 5);
      audioRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      handleTogglePlay();
    }
  };

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className={classNames("flex items-center gap-2.5 min-w-[210px] rounded-lg px-1 py-1")}>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => {
          setPlaying(true);
          audioPlaybackManager.play(instanceId, () => {
            audioRef.current?.pause();
            setPlaying(false);
          });
        }}
        onPause={() => {
          setPlaying(false);
          audioPlaybackManager.pause(instanceId);
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
          audioPlaybackManager.pause(instanceId);
        }}
        onLoadedMetadata={(e) => {
          const real = e.currentTarget.duration;
          if (Number.isFinite(real) && real > 0) setDuration(real);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
        onError={() => {
          setState("error");
          setErrorMsg("Couldn't play this voice message.");
          audioPlaybackManager.pause(instanceId);
        }}
        className="hidden"
      />

      <button
        onClick={handleTogglePlay}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        disabled={state === "loading"}
        className={classNames(
          "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors",
          isOwn ? "bg-white/20 hover:bg-white/30 text-white" : "bg-brand-soft hover:bg-brand/20 text-brand",
          state === "error" && "text-coral"
        )}
      >
        {state === "loading" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : state === "error" ? (
          <AlertCircle className="w-4 h-4" />
        ) : playing ? (
          <Pause className="w-4 h-4" fill="currentColor" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div
          ref={progressBarRef}
          onClick={handleSeek}
          onKeyDown={handleKeyDown}
          role="slider"
          aria-label="Seek voice message"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          tabIndex={0}
          className={classNames(
            "h-2 rounded-full overflow-hidden cursor-pointer relative flex items-center focus:outline-none focus:ring-1 focus:ring-brand/50",
            isOwn ? "bg-white/25" : "bg-slate-line"
          )}
        >
          <div
            className={classNames("h-full rounded-full transition-all duration-75", isOwn ? "bg-white" : "bg-brand")}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className={classNames("flex items-center gap-1 mt-1 text-[11px]", isOwn ? "text-white/75" : "text-slate-muted")}>
          <Mic className="w-3 h-3 shrink-0" />
          <span className="truncate">
            {errorMsg || `Voice message · ${formatDuration(playing || currentTime ? currentTime : duration)}`}
          </span>
        </div>
      </div>
    </div>
  );
};

export default AudioMessage;
