import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from "react";
import type { SpeechSettings } from "../audio/speech";
import { DEFAULT_VISION, type VisionSettings } from "../vision";
import { CONTROLLER_ACTIONS, EMPTY_SESSION, freshSession, sessionReducer, type Session, type SessionAction } from "./session";

export * from "./session";

export interface CaptureSettings {
  /** "auto" waits for a still screen; "interval" analyses on a fixed timer. */
  mode: "auto" | "interval";
  intervalSec: number;
  /** Motion threshold (0-255 mean pixel change) under which the screen counts as still. */
  stillThreshold: number;
  /** Hard cap on vision calls per match, so a stuck loop cannot run up a bill. */
  maxCalls: number;
}

export interface SyncSettings {
  /** Shared code linking the device that sends screenshots to the device that shows the coach. */
  room: string;
  /** When on, this device shows and speaks whatever the room's screenshots produce. */
  follow: boolean;
}

export interface Settings {
  vision: VisionSettings;
  speech: SpeechSettings;
  capture: CaptureSettings;
  sync: SyncSettings;
}

const newRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "X");

export interface State {
  settings: Settings;
  session: Session;
}

export const DEFAULT_SETTINGS: Settings = {
  vision: DEFAULT_VISION,
  speech: { enabled: true, rate: 1.05, volume: 1 },
  capture: { mode: "auto", intervalSec: 20, stillThreshold: 3, maxCalls: 80 },
  sync: { room: "", follow: false },
};

export type Action = SessionAction | { type: "settings"; patch: Partial<Settings> };

function reducer(state: State, a: Action): State {
  if (a.type === "settings") return { ...state, settings: { ...state.settings, ...a.patch } };
  const session = sessionReducer(state.session, a);
  return session === state.session ? state : { ...state, session };
}

const KEY_SETTINGS = "mlbb-guru:settings:v1";
const KEY_SESSION = "mlbb-guru:session:v1";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

/** A link like https://site/?room=ABC123 puts this device straight into follow mode for that room. */
function initialSync(saved: SyncSettings | undefined): SyncSettings {
  const fromLink = typeof location !== "undefined" ? new URLSearchParams(location.search).get("room") : null;
  const clean = (fromLink ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32).toUpperCase();
  if (clean) return { room: clean, follow: true };
  return { room: saved?.room || newRoomCode(), follow: saved?.follow ?? false };
}

function initialState(): State {
  const saved = load<Settings>(KEY_SETTINGS, DEFAULT_SETTINGS);
  return {
    settings: {
      vision: { ...DEFAULT_SETTINGS.vision, ...saved.vision },
      speech: { ...DEFAULT_SETTINGS.speech, ...saved.speech },
      capture: { ...DEFAULT_SETTINGS.capture, ...saved.capture },
      sync: initialSync(saved.sync),
    },
    session: freshSession(load<Session>(KEY_SESSION, EMPTY_SESSION), Date.now()),
  };
}

const Ctx = createContext<{ state: State; dispatch: Dispatch<Action> } | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  useEffect(() => {
    try {
      localStorage.setItem(KEY_SETTINGS, JSON.stringify(state.settings));
    } catch {
      /* private mode: settings just won't persist */
    }
  }, [state.settings]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY_SESSION, JSON.stringify(state.session));
    } catch {
      /* ignore */
    }
  }, [state.session]);
  // In follow mode this device is the controller: what you tap here also changes the server's copy,
  // so the next screenshot from the iPad is read against it.
  const syncRef = useRef(state.settings.sync);
  syncRef.current = state.settings.sync;
  const send = useCallback((action: Action) => {
    dispatch(action);
    const { follow, room } = syncRef.current;
    if (!follow || !room || action.type === "settings" || !CONTROLLER_ACTIONS.has(action.type)) return;
    void fetch(`/api/coach?room=${encodeURIComponent(room)}&action=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => undefined);
  }, []);
  const value = useMemo(() => ({ state, dispatch: send }), [state, send]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
