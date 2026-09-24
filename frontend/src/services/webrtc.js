/**
 * WebRTC configuration for private voice/video calls.
 *
 * STUN is always included so NAT traversal works out of the box in
 * development. TURN is entirely optional and configured through Vite env
 * vars — never hard-coded — so a relay server can be added for production
 * without touching code. If VITE_TURN_URL is unset, calls simply fall back
 * to STUN-only (works on most networks, may fail on strict corporate/mobile
 * NATs — that's a deployment/infra concern, not a code gap).
 */
export function getIceServers() {
  const servers = [
    { urls: (import.meta.env?.VITE_STUN_URLS || "stun:stun.l.google.com:19302").split(",") },
  ];

  const turnUrl = import.meta.env?.VITE_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl.split(","),
      username: import.meta.env?.VITE_TURN_USERNAME || undefined,
      credential: import.meta.env?.VITE_TURN_CREDENTIAL || undefined,
    });
  }
  return servers;
}

export function createPeerConnection() {
  return new RTCPeerConnection({ iceServers: getIceServers() });
}

/** True if this browser supports the WebRTC APIs a call needs. */
export function isWebRTCSupported() {
  return !!(
    typeof window !== "undefined" &&
    window.RTCPeerConnection &&
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia
  );
}

/**
 * Requests mic (+ camera for video calls) with human-readable error
 * messages for the common permission/hardware failure modes, instead of
 * letting a raw DOMException reach the UI.
 */
export async function getLocalMedia(type) {
  if (!isWebRTCSupported()) {
    throw new Error("Your browser doesn't support voice or video calling.");
  }
  const constraints = {
    audio: true,
    video: type === "video" ? { width: 640, height: 480 } : false,
  };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      throw new Error(
        type === "video"
          ? "Camera and microphone permission is required for video calls."
          : "Microphone permission is required for voice calls.",
      );
    }
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      throw new Error(
        type === "video"
          ? "No camera or microphone was found on this device."
          : "No microphone was found on this device.",
      );
    }
    throw new Error("Unable to establish the call. Please try again.");
  }
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}
