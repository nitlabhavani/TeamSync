/**
 * AUDIO PLAYBACK COORDINATOR
 * ==========================
 * Ensures only one voice message is playing at a time across the entire
 * application. When a voice message starts playing, any currently playing
 * audio message is cleanly paused.
 */

let currentStopCallback = null;
let currentPlayingId = null;

export const audioPlaybackManager = {
  play(id, stopCallback) {
    if (currentPlayingId && currentPlayingId !== id && typeof currentStopCallback === "function") {
      try {
        currentStopCallback();
      } catch {
        /* ignore */
      }
    }
    currentPlayingId = id;
    currentStopCallback = stopCallback;
  },

  pause(id) {
    if (currentPlayingId === id) {
      currentPlayingId = null;
      currentStopCallback = null;
    }
  },

  stopAll() {
    if (typeof currentStopCallback === "function") {
      try {
        currentStopCallback();
      } catch {
        /* ignore */
      }
    }
    currentPlayingId = null;
    currentStopCallback = null;
  },
};
