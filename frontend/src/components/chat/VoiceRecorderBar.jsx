import { useEffect, useRef, useState } from "react";
import { Trash2, Square, Play, Pause, Loader2, Send, AlertCircle } from "lucide-react";
import { formatDuration } from "../../utils/helperFunctions";

/**
 * PRIVATE VOICE MESSAGES — renders in place of the normal composer row
 * whenever a recording is in progress or a finished recording is waiting
 * to be sent. Two sub-states:
 *
 *  - recording: "🔴 Recording 0:08" + Delete/Stop, live timer driven by the
 *    real elapsed time from useVoiceRecorder (never a fake/simulated tick).
 *  - preview: local playback of the just-recorded blob (via a real
 *    <audio> element pointed at the recorder's own blob: object URL — no
 *    network round-trip needed to preview your own recording) + Delete/Send.
 *
 * `sending`/`uploadError` are owned by ChatInput (the actual upload only
 * happens on Send, per the "don't upload until Send" requirement).
 */
const VoiceRecorderBar = ({ recorder, onDiscard, onSend, sending, uploadError }) => {
  const { status, elapsedSeconds, previewUrl, maxSeconds, stopRecording } = recorder;
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setPreviewTime(0);
  }, [previewUrl]);

  const togglePreviewPlayback = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play().catch(() => {});
    }
  };

  if (status === "recording") {
    const nearLimit = elapsedSeconds >= maxSeconds - 5;
    return (
      <div className="flex items-center gap-3 bg-cloud rounded-2xl px-4 py-2.5">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-coral opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-coral" />
        </span>
        <span className={`text-sm font-medium tabular-nums ${nearLimit ? "text-coral" : "text-slate-ink"}`}>
          Recording {formatDuration(elapsedSeconds)}
        </span>
        <span className="text-xs text-slate-muted">/ {formatDuration(maxSeconds)} max</span>
        <div className="flex-1" />
        <button
          onClick={onDiscard}
          aria-label="Delete recording"
          title="Delete recording"
          className="w-9 h-9 rounded-full hover:bg-coral-soft flex items-center justify-center text-slate-muted hover:text-coral transition-colors"
        >
          <Trash2 className="w-[18px] h-[18px]" />
        </button>
        <button
          onClick={stopRecording}
          aria-label="Stop recording"
          title="Stop recording"
          className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-white transition-colors"
        >
          <Square className="w-4 h-4" fill="currentColor" />
        </button>
      </div>
    );
  }

  if (status === "preview") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3 bg-cloud rounded-2xl px-4 py-2.5">
          <audio
            ref={audioRef}
            src={previewUrl}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onLoadedMetadata={(e) => setPreviewDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setPreviewTime(e.currentTarget.currentTime || 0)}
            className="hidden"
          />
          <button
            onClick={togglePreviewPlayback}
            aria-label={playing ? "Pause preview" : "Play preview"}
            className="w-9 h-9 rounded-full bg-brand flex items-center justify-center text-white shrink-0"
          >
            {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
          </button>
          <span className="text-sm font-medium text-slate-ink tabular-nums">
            {formatDuration(previewTime)} / {formatDuration(previewDuration || elapsedSeconds)}
          </span>
          <div className="flex-1" />
          <button
            onClick={onDiscard}
            disabled={sending}
            aria-label="Delete recording"
            title="Delete recording"
            className="w-9 h-9 rounded-full hover:bg-coral-soft flex items-center justify-center text-slate-muted hover:text-coral disabled:opacity-40 transition-colors"
          >
            <Trash2 className="w-[18px] h-[18px]" />
          </button>
          <button
            onClick={onSend}
            disabled={sending}
            aria-label="Send voice message"
            title="Send voice message"
            className="w-10 h-10 rounded-full bg-brand disabled:bg-slate-line disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors"
          >
            {sending ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Send className="w-[18px] h-[18px]" />}
          </button>
        </div>
        {uploadError && (
          <p className="text-xs text-coral flex items-center gap-1 px-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {uploadError}
          </p>
        )}
      </div>
    );
  }

  return null;
};

export default VoiceRecorderBar;
