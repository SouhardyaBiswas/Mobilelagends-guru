import { useEffect, useRef, useState } from "react";
import { speaker } from "../audio/speech";
import { useStore } from "../state/store";
import type { Session } from "../state/session";

const POLL_MS = 3000;
/** With nothing new for a while the dashboard checks less often; it speeds up again the moment something arrives. */
const pollDelay = (idleMs: number) => (idleMs > 45 * 60_000 ? 20_000 : idleMs > 10 * 60_000 ? 6000 : POLL_MS);

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
  /** The room's log: recent screenshots and what each was understood to be. */
  reads?: RoomRead[];
}

export interface RoomRead {
  at: number;
  screen?: string;
  clock?: number;
  gold?: number;
  allies?: number;
  enemies?: number;
  unknown?: string[];
  ms?: number;
  model?: string;
  error?: string;
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
  announce?: { id: number; text: string };
  reads?: RoomRead[];
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
  /** Last voice-question answer already spoken; undefined until the first poll so old answers are not replayed. */
  const announced = useRef<number | undefined>(undefined);
  const sessionRef = useRef(state.session);
  sessionRef.current = state.session;

  useEffect(() => {
    if (!follow || !room) return;
    version.current = 0;
    setStatus({ version: 0 });
    let stopped = false;
    let lastChange = Date.now();
    let adoptedAt = 0;
    const url = `/api/coach?room=${encodeURIComponent(room)}`;

    const poll = async () => {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch(`${url}&v=${version.current}`, { cache: "no-store" });
        const body = (await res.json()) as RoomAnswer;
        if (stopped) return;
        if (!body.ok) throw new Error(`HTTP ${res.status}`);
        // Nothing has changed since the copy we hold: the server sends only the version number.
        if (body.unchanged) {
          setStatus((prev) => (prev.error ? { ...prev, error: undefined } : prev));
          return;
        }
        lastChange = Date.now();
        const remote = body.version ?? 0;
        if (remote === 0 && version.current > 0) {
          // The server lost the room (it restarted). Give it back what we have.
          await fetch(`${url}&restore=1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: { ...sessionRef.current, log: [] } }) });
          version.current = 0;
          return;
        }
        // The shared store can hand back the previous copy for a moment after a write. An older
        // version arriving right after a newer one is that, not news: keep what we have.
        if (remote !== 0 && remote < version.current && Date.now() - adoptedAt < 10_000) return;
        if (body.session && remote !== version.current) {
          version.current = remote;
          adoptedAt = Date.now();
          dispatch({ type: "adopt", session: body.session });
        }
        // The answer to a voice question asked on the iPad: say it here, once.
        const note = body.announce;
        if (note && announced.current !== undefined && note.id !== announced.current) {
          speaker.say(note.text, 2);
          dispatch({ type: "log", entry: { at: Date.now(), kind: "say", text: note.text } });
        }
        announced.current = note?.id ?? 0;
        setStatus((prev) => ({ version: remote, lastReadAt: body.at, readError: body.error, lastRead: body.read, reads: body.reads ?? prev.reads }));
      } catch {
        if (!stopped) setStatus((s) => ({ ...s, error: "Can't reach the coach server. This works on the deployed site only." }));
      }
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await poll();
      if (!stopped) timer = setTimeout(() => void loop(), pollDelay(Date.now() - lastChange));
    };
    void loop();
    const onVisible = () => {
      // Back on screen: check at once and at full speed.
      lastChange = Date.now();
      void poll();
    };
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
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("visibilitychange", hold);
      void lock?.release().catch(() => undefined);
    };
  }, [follow, room, dispatch]);

  return follow && room ? status : undefined;
}
