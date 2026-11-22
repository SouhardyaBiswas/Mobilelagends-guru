import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { Session } from "../state/session";

const POLL_MS = 3000;

export interface RoomStatus {
  /** Server version of the room: 0 until the first screenshot arrives. */
  version: number;
  /** When the last screenshot was read (server clock, ms). */
  lastReadAt?: number;
  error?: string;
  /** Why the iPad's most recent screenshot could not be read (bad key, quota, wrong upload…). */
  readError?: string;
  /** What the most recent screenshot turned out to be. */
  lastRead?: { screen: string; title: string; body: string };
}

/** Plain names for what a screenshot showed. */
export const SCREEN_LABEL: Record<string, string> = {
  draft: "hero selection",
  loading: "the loading screen",
  scoreboard: "the scoreboard",
  shop: "the shop",
  gameplay: "gameplay",
  post_game: "the results screen",
  other: "not a game screen",
};

interface RoomAnswer {
  ok?: boolean;
  version?: number;
  unchanged?: boolean;
  session?: Session;
  at?: number;
  error?: string;
  read?: { screen: string; title: string; body: string };
}

/**
 * Follow mode: this device mirrors a room. Another device (the iPad, through a
 * Shortcut) posts screenshots to the server; we poll for the resulting match
 * state and adopt it, so the normal Live coach screen shows and speaks it.
 *
 * The server keeps rooms in memory only. If it forgets one, we hand our copy
 * back so the match carries on.
 */
export function useRoomSync(): RoomStatus | undefined {
  const { state, dispatch } = useStore();
  const { room, follow } = state.settings.sync;
  const [status, setStatus] = useState<RoomStatus>({ version: 0 });
  const version = useRef(0);
  const sessionRef = useRef(state.session);
  sessionRef.current = state.session;

  useEffect(() => {
    if (!follow || !room) return;
    version.current = 0;
    setStatus({ version: 0 });
    let stopped = false;
    const url = `/api/coach?room=${encodeURIComponent(room)}`;

    const poll = async () => {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch(`${url}&v=${version.current}`, { cache: "no-store" });
        const body = (await res.json()) as RoomAnswer;
        if (stopped) return;
        if (!body.ok) throw new Error(`HTTP ${res.status}`);
        const remote = body.version ?? 0;
        if (remote === 0 && version.current > 0) {
          // The server lost the room (it restarted). Give it back what we have.
          await fetch(`${url}&restore=1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: { ...sessionRef.current, log: [] } }) });
          version.current = 0;
          return;
        }
        if (body.session && remote !== version.current) {
          version.current = remote;
          dispatch({ type: "adopt", session: body.session });
        }
        setStatus({ version: remote, lastReadAt: body.at, readError: body.error, lastRead: body.read });
      } catch {
        if (!stopped) setStatus((s) => ({ ...s, error: "Can't reach the coach server. This works on the deployed site only." }));
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => void poll();
    document.addEventListener("visibilitychange", onVisible);

    // Keep the screen on while following, so the phone doesn't sleep mid-match.
    let lock: WakeLockSentinel | undefined;
    const hold = () => {
      if (document.hidden || !("wakeLock" in navigator)) return;
      navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => undefined);
    };
    hold();
    document.addEventListener("visibilitychange", hold);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("visibilitychange", hold);
      void lock?.release().catch(() => undefined);
    };
  }, [follow, room, dispatch]);

  return follow && room ? status : undefined;
}
