import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_VOICE_RECORDING_SECONDS } from "../utils/constants";

/**
 * PRIVATE VOICE MESSAGES — real microphone recording via the browser's
 * actual MediaRecorder API (navigator.mediaDevices.getUserMedia +
 * MediaRecorder). No fake timer, no placeholder/base64 audio: `elapsedMs`
 * is measured from real timestamps, and the produced `blob` is genuine
 * recorded audio in whatever MIME type this browser actually supports
 * (see PREFERRED_MIME_TYPES below) — never hard-coded to one format.
 *
 * States: "idle" -> "recording" -> "preview" (stopped, blob ready to play
 * or send) -> back to "idle" after send/discard. "denied"/"unsupported"/
 * "error" are terminal-ish states surfaced with a specific message per
 * requirement (see ERROR_MESSAGES) rather than crashing the component.
 *
 * Cleanup is unconditional: every code path that leaves "recording" —
 * manual stop, hitting MAX_VOICE_RECORDING_SECONDS, discard, unmount,
 * navigating away — stops every MediaStream track, releases the
 * MediaRecorder, clears the interval timer, and revokes the object URL.
 * Nothing is ever left recording in the background.
 */

// Checked in this order — MediaRecorder.isTypeSupported() decides at
// runtime which one this actual browser can record, never assumed.
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

const pickSupportedMimeType = () => {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null;
  return PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || null;
};

export const ERROR_MESSAGES = {
  denied: "Microphone permission is required to record a voice message.",
  "no-device": "Microphone is not available on this device.",
  unsupported: "Voice recording is not supported in this browser.",
  "start-failed": "Unable to start voice recording. Please try again.",
};

export const useVoiceRecorder = (maxSeconds = MAX_VOICE_RECORDING_SECONDS) => {
  const [status, setStatus] = useState("idle"); // idle | requesting | recording | preview | error
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [blob, setBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startTimeRef = useRef(0);
  const intervalRef = useRef(null);
  const mimeTypeRef = useRef("");
  const mountedRef = useRef(true);

  const clearTick = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const revokePreview = useCallback(() => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  /** Full teardown — used by discard, unmount, and stop-then-restart. */
  const hardReset = useCallback(() => {
    clearTick();
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      /* already stopped/invalid state — fine, we're tearing down anyway */
    }
    recorderRef.current = null;
    releaseStream();
    chunksRef.current = [];
    revokePreview();
    setBlob(null);
    setElapsedMs(0);
  }, [revokePreview]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Component unmounted / chat closed mid-recording — never let a
      // MediaStream or MediaRecorder keep running in the background.
      mountedRef.current = false;
      hardReset();
    };
    // hardReset is stable (useCallback with a stable dep), and this effect
    // must only ever run its mount/unmount pair once — intentionally not
    // re-running on every hardReset identity change.
  }, [hardReset]);

  const finishAndBuildPreview = useCallback(() => {
    clearTick();
    releaseStream();
    const finalBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || "audio/webm" });
    chunksRef.current = [];
    if (!mountedRef.current) return;
    if (finalBlob.size === 0) {
      setStatus("idle");
      setElapsedMs(0);
      return;
    }
    setBlob(finalBlob);
    setPreviewUrl(URL.createObjectURL(finalBlob));
    setStatus("preview");
  }, []);

  const startRecording = useCallback(async () => {
    if (status === "requesting" || status === "recording") return; // guards double-click
    setErrorMessage("");
    revokePreview();
    setBlob(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setStatus("error");
      setErrorMessage(ERROR_MESSAGES.unsupported);
      return;
    }
    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      setStatus("error");
      setErrorMessage(ERROR_MESSAGES.unsupported);
      return;
    }

    setStatus("requesting");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (!mountedRef.current) return;
      setStatus("error");
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        setErrorMessage(ERROR_MESSAGES.denied);
      } else if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
        setErrorMessage(ERROR_MESSAGES["no-device"]);
      } else {
        setErrorMessage(ERROR_MESSAGES["start-failed"]);
      }
      return;
    }
    if (!mountedRef.current) {
      // Unmounted while the permission prompt was open — don't leave the
      // just-granted stream open.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    try {
      streamRef.current = stream;
      mimeTypeRef.current = mimeType;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = finishAndBuildPreview;
      recorder.onerror = () => {
        if (!mountedRef.current) return;
        setStatus("error");
        setErrorMessage(ERROR_MESSAGES["start-failed"]);
        hardReset();
      };
      recorderRef.current = recorder;
      startTimeRef.current = Date.now();
      recorder.start();
      setStatus("recording");
      setElapsedMs(0);
      intervalRef.current = setInterval(() => {
        const ms = Date.now() - startTimeRef.current;
        setElapsedMs(ms);
        // REQUIRED RECORDING LIMIT — auto-stop, never silently discard: the
        // "stop" branch below preserves whatever was captured for preview.
        if (ms >= maxSeconds * 1000) {
          clearTick();
          try {
            recorderRef.current?.stop();
          } catch {
            /* already stopping */
          }
        }
      }, 200);
    } catch {
      if (!mountedRef.current) return;
      setStatus("error");
      setErrorMessage(ERROR_MESSAGES["start-failed"]);
      releaseStream();
    }
  }, [status, maxSeconds, revokePreview, finishAndBuildPreview, hardReset]);

  const stopRecording = useCallback(() => {
    if (status !== "recording") return;
    clearTick();
    try {
      recorderRef.current?.stop(); // -> onstop -> finishAndBuildPreview -> "preview"
    } catch {
      releaseStream();
      setStatus("idle");
    }
  }, [status]);

  const discardRecording = useCallback(() => {
    hardReset();
    setStatus("idle");
    setErrorMessage("");
  }, [hardReset]);

  const reset = useCallback(() => {
    hardReset();
    setStatus("idle");
    setErrorMessage("");
  }, [hardReset]);

  return {
    status, // idle | requesting | recording | preview | error
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    errorMessage,
    blob,
    mimeType: mimeTypeRef.current,
    previewUrl,
    maxSeconds,
    startRecording,
    stopRecording,
    discardRecording,
    reset,
    webrtcSupported:
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined",
  };
};
