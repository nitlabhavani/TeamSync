/**
 * STEP 34 (post-verification fix) — notification-target message highlight
 * lifecycle, extracted out of GroupChat.jsx into plain, framework-free
 * logic so its timer semantics can be regression-tested with plain Node
 * (see frontend/scripts/testHighlightController.js) without needing a
 * browser or a React test renderer, neither of which this project has
 * installed.
 *
 * THE BUG THIS FIXES:
 * GroupChat previously scheduled the "clear the highlight after ~2.5s"
 * timer as a `useEffect` cleanup function, keyed on `highlightMessageId`.
 * That effect also called the parent's `onHighlightShown()` synchronously,
 * which clears `highlightMessageId` in the parent and therefore changes
 * this effect's own dependency. React then runs the effect's cleanup
 * function — which was `clearTimeout(timer)` — immediately, cancelling the
 * timer before it ever got to clear the highlight. The message stayed
 * highlighted forever.
 *
 * THE FIX:
 * The timer now lives here, outside of any React effect's
 * dependency/cleanup lifecycle, held by the caller in a ref (see
 * GroupChat.jsx). It is only ever touched by:
 *   - show(id): replaces whatever highlight/timer is currently in flight
 *     with a new one (a second notification target always fully replaces
 *     the first, never stacks/leaks it) and schedules its own clear;
 *   - its own setTimeout callback, which unconditionally fires ~2.5s later
 *     regardless of what happened to `highlightMessageId` in the meantime;
 *   - clearNow(): message not found — clear without scheduling anything;
 *   - reset(): a hard stop with no `onChange` guarantees, for group
 *     switches/unmounts, so a timer started for one group can never leak
 *     into another.
 */
export function createHighlightController({ durationMs = 2500, onChange } = {}) {
  let timer = null;
  let activeId = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const setActive = (id) => {
    activeId = id;
    onChange?.(activeId);
  };

  return {
    /**
     * Show (or replace) a highlight for `id`. Always fully replaces
     * whatever highlight/timer is currently in flight, then schedules a
     * fresh, independent timer to clear it after `durationMs`.
     */
    show(id) {
      clearTimer();
      setActive(id);
      timer = setTimeout(() => {
        timer = null;
        setActive(null);
      }, durationMs);
    },

    /** No message found for the target — clear without scheduling a timer. */
    clearNow() {
      clearTimer();
      setActive(null);
    },

    /**
     * Hard reset for group switches / unmount. Does not fire `onChange` —
     * the caller is expected to reset its own local state in the same
     * breath (see GroupChat.jsx's group-change cleanup effect).
     */
    reset() {
      clearTimer();
      activeId = null;
    },

    getActiveId: () => activeId,
    /** Test-only introspection: is a clear-timer currently scheduled? */
    hasPendingTimer: () => timer !== null,
  };
}
