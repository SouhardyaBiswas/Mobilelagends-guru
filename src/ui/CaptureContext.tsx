import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FrameSource, frameFromBlob, type CaptureKind, type Frame } from "../capture/capture";
import { DEFAULT_STILLNESS, StillnessDetector } from "../capture/stillness";
import { Ticker } from "../capture/ticker";
import { useStore } from "../state/store";
import type { ScreenKind } from "../types";
import { analyzeFrame, estimateCostUsd, VisionError } from "../vision";

const TICK_MS = 700;

export interface CaptureStatus {
  active: boolean;
  kind?: CaptureKind;
  busy: boolean;
  /** Mean pixel change between the last two samples (0 = frozen). */
  motion: number;
  last?: { screen: ScreenKind; ms: number; model?: string; at: number; found: string };
  error?: string;
}

interface CaptureApi {
  status: CaptureStatus;
  start: (kind: CaptureKind) => Promise<void>;
  stop: () => void;
  analyzeNow: () => void;
  analyzeFile: (file: Blob) => Promise<void>;
}

const Ctx = createContext<CaptureApi | undefined>(undefined);

/** Owns the capture stream and the analyse loop so they survive tab switches. */
export function CaptureProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;

  const source = useRef(new FrameSource());
  const ticker = useRef(new Ticker());
  const detector = useRef(new StillnessDetector());
  const busy = useRef(false);
  const lastIntervalAt = useRef(0);
  const [status, setStatus] = useState<CaptureStatus>({ active: false, busy: false, motion: 0 });

  const log = useCallback(
    (kind: "vision" | "error", text: string) => dispatch({ type: "log", entry: { at: Date.now(), kind, text } }),
    [dispatch],
  );

  const analyze = useCallback(
    async (frame: Frame) => {
      if (busy.current) return;
      const s = stateRef.current;
      if (s.session.calls >= s.settings.capture.maxCalls) {
        setStatus((st) => ({ ...st, error: `Stopped: reached the ${s.settings.capture.maxCalls}-call limit for this match (raise it in Settings).` }));
        return;
      }
      busy.current = true;
      setStatus((st) => ({ ...st, busy: true, error: undefined }));
      try {
        const res = await analyzeFrame(s.settings.vision, frame.jpegBase64, {
          myHeroId: s.session.myHeroId,
          allies: s.session.allies,
          enemies: s.session.enemies,
        });
        const obs = res.observation;
        dispatch({ type: "observe", obs, now: Date.now(), costUsd: estimateCostUsd(res.model, res.usage) ?? 0 });
        const found = `${obs.allies.length} allies, ${obs.enemies.length} enemies${obs.myGold !== undefined ? `, ${obs.myGold} gold` : ""}`;
        log("vision", `Read ${obs.screen} screen in ${(res.ms / 1000).toFixed(1)}s — ${found}${obs.unknown.length ? ` (unrecognised: ${obs.unknown.slice(0, 4).join(", ")})` : ""}`);
        setStatus((st) => ({ ...st, busy: false, last: { screen: obs.screen, ms: res.ms, model: res.model, at: Date.now(), found } }));
      } catch (err) {
        const message = err instanceof VisionError ? err.message : err instanceof Error ? err.message : String(err);
        log("error", message);
        setStatus((st) => ({ ...st, busy: false, error: message }));
      } finally {
        busy.current = false;
      }
    },
    [dispatch, log],
  );

  const tick = useCallback(() => {
    const src = source.current;
    const sig = src.sample();
    if (!sig) return;
    const cap = stateRef.current.settings.capture;
    // A hand-held or tripod camera never holds perfectly still; be more forgiving.
    const still = cap.stillThreshold * (src.kind === "camera" ? 2.5 : 1);
    detector.current.options = { ...DEFAULT_STILLNESS, stillThreshold: still, changeThreshold: Math.max(DEFAULT_STILLNESS.changeThreshold, still * 2.5) };
    const now = Date.now();
    const r = detector.current.push(sig, now);
    setStatus((st) => (Math.abs(st.motion - r.motion) > 0.2 ? { ...st, motion: r.motion } : st));
    const due = cap.mode === "auto" ? r.fire : now - lastIntervalAt.current >= cap.intervalSec * 1000;
    if (due && !busy.current) {
      lastIntervalAt.current = now;
      const frame = src.grab();
      if (frame) void analyze(frame);
    }
  }, [analyze]);

  const stop = useCallback(() => {
    ticker.current.stop();
    source.current.stop();
    setStatus((st) => ({ ...st, active: false, kind: undefined, motion: 0 }));
  }, []);

  const start = useCallback(
    async (kind: CaptureKind) => {
      try {
        await source.current.start(kind);
        source.current.onEnded = stop;
        detector.current.reset();
        lastIntervalAt.current = 0;
        ticker.current.start(TICK_MS, tick);
        setStatus((st) => ({ ...st, active: true, kind, error: undefined }));
      } catch (err) {
        const denied = err instanceof DOMException && err.name === "NotAllowedError";
        setStatus((st) => ({
          ...st,
          active: false,
          error: denied ? "Capture permission was denied." : `Could not start capture: ${err instanceof Error ? err.message : err}`,
        }));
      }
    },
    [stop, tick],
  );

  const analyzeNow = useCallback(() => {
    const frame = source.current.grab();
    if (frame) {
      detector.current.reset();
      void analyze(frame);
    } else if (stateRef.current.settings.vision.provider === "demo") {
      // Demo mode needs no picture: run the scripted match through the same pipeline.
      void analyze({ jpegBase64: "", signature: new Uint8Array(), width: 0, height: 0 });
    } else {
      setStatus((st) => ({ ...st, error: "Nothing to read yet — share your screen, start the camera, or upload a screenshot." }));
    }
  }, [analyze]);

  const analyzeFile = useCallback(
    async (file: Blob) => {
      // Demo mode plays a scripted match; answering a real screenshot with it would look like a (wrong) read.
      if (stateRef.current.settings.vision.provider === "demo") {
        setStatus((st) => ({ ...st, error: "Demo mode can't read real screenshots. Add a free Gemini key in Settings → Screen reading first." }));
        return;
      }
      await analyze(await frameFromBlob(file));
    },
    [analyze],
  );

  useEffect(() => {
    const t = ticker.current;
    const s = source.current;
    return () => {
      t.stop();
      s.stop();
    };
  }, []);

  const api = useMemo(() => ({ status, start, stop, analyzeNow, analyzeFile }), [status, start, stop, analyzeNow, analyzeFile]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCapture(): CaptureApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCapture must be used inside CaptureProvider");
  return ctx;
}
