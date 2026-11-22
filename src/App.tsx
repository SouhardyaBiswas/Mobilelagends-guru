import { useEffect, useMemo, useRef, useState } from "react";
import { speaker } from "./audio/speech";
import { Ticker } from "./capture/ticker";
import { heroById } from "./data/heroes";
import { planBuild } from "./engine/build";
import { guessLaneOpponent } from "./engine/tips";
import { enemyStates, gameSeconds, STAGE_LABEL, stageOf, StoreProvider, useStore } from "./state/store";
import { CaptureProvider } from "./ui/CaptureContext";
import { DraftTab } from "./ui/DraftTab";
import { LiveTab } from "./ui/LiveTab";
import { SettingsTab } from "./ui/SettingsTab";
import { useCoach } from "./ui/useCoach";
import { SCREEN_LABEL, useRoomSync } from "./ui/useRoomSync";

type Tab = "draft" | "live" | "settings";

const agoText = (now: number, at?: number) => {
  if (!at) return "just now";
  const sec = Math.max(0, Math.round((now - at) / 1000));
  return sec < 5 ? "just now" : sec < 90 ? `${sec}s ago` : `${Math.round(sec / 60)} min ago`;
};
const LATE_GAME_SEC = 15 * 60;

function Shell() {
  const { state, dispatch } = useStore();
  const { session, settings } = state;
  const [tab, setTab] = useState<Tab>(session.phase === "live" ? "live" : "draft");
  const [now, setNow] = useState(() => Date.now());

  // One-second heartbeat that keeps running when the tab is in the background.
  useEffect(() => {
    const ticker = new Ticker();
    ticker.start(1000, () => setNow(Date.now()));
    return () => ticker.stop();
  }, []);

  const gameSec = gameSeconds(session, now);
  const hero = session.myHeroId ? heroById(session.myHeroId) : undefined;
  const late = (gameSec ?? 0) >= LATE_GAME_SEC;
  const plan = useMemo(
    () =>
      hero
        ? planBuild({
            hero,
            lane: session.lane,
            enemies: enemyStates(session),
            owned: session.owned,
            gold: session.phase === "live" ? session.gold : undefined,
            gameTimeSec: late ? LATE_GAME_SEC : 0,
            plannedBuild: session.plannedBuild,
            shopListed: session.shopListed,
            priceFactor: session.priceFactor,
          })
        : undefined,
    // The plan depends on these session fields only; the ticking clock must not rebuild it every second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hero, session.lane, session.enemies, session.enemyLive, session.manualFed, session.owned, session.gold, session.phase, late, session.plannedBuild, session.shopListed, session.priceFactor],
  );
  // Lane opponent: what the player told us, else the enemy whose lane matches theirs.
  const laneOpponentId = useMemo(() => {
    if (session.laneOpponentId && session.enemies.includes(session.laneOpponentId)) return session.laneOpponentId;
    return guessLaneOpponent(session.lane, session.enemies);
  }, [session.laneOpponentId, session.enemies, session.lane]);
  const repeat = useCoach(plan, hero, gameSec, laneOpponentId);
  const room = useRoomSync();
  // In follow mode the match arrives from the server, so open on the coach.
  useEffect(() => {
    if (room) setTab(session.phase === "live" ? "live" : "draft");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!room]);
  const stage = stageOf(session);

  // When a screen read moves the match into (or out of) play, follow it.
  const lastPhase = useRef(session.phase);
  useEffect(() => {
    if (session.phase !== lastPhase.current) {
      lastPhase.current = session.phase;
      setTab(session.phase === "live" ? "live" : "draft");
    }
  }, [session.phase]);

  const voiceOn = settings.speech.enabled;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="./icon.svg" alt="" width={28} height={28} />
          <span>MLBB Guru</span>
        </div>
        <nav className="tabs" aria-label="Sections">
          {(["draft", "live", "settings"] as const).map((t) => (
            <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined}>
              {t === "draft" ? "Draft" : t === "live" ? "Live coach" : "Settings"}
              {t === "live" && session.phase === "live" && <i className="dot" />}
            </button>
          ))}
        </nav>
        <button
          className={`btn ghost voice ${voiceOn ? "on" : ""}`}
          onClick={() => {
            if (!voiceOn) speaker.unlock();
            dispatch({ type: "settings", patch: { speech: { ...settings.speech, enabled: !voiceOn } } });
          }}
          aria-pressed={voiceOn}
          title={voiceOn ? "Voice on — tap to mute" : "Voice muted — tap to turn on"}
        >
          {voiceOn ? "🔊 Voice on" : "🔇 Muted"}
        </button>
      </header>

      {room && (
        <div className={`roombar ${room.error || room.readError ? "bad" : room.version ? "ok" : ""}`}>
          📡 Following room <strong>{settings.sync.room}</strong> —{" "}
          {room.error ??
            (room.readError
              ? `the last screenshot could not be read: ${room.readError}`
              : room.lastReadAt
                ? `last screenshot read ${agoText(now, room.lastReadAt)}${room.lastRead ? ` · it showed ${SCREEN_LABEL[room.lastRead.screen] ?? room.lastRead.screen}` : ""}`
                : "waiting for the first screenshot from your iPad")}
          {!settings.speech.enabled && " · voice is muted"}
          <div className="stages" role="group" aria-label="Match stage">
            {(["draft", "loading", "live", "done"] as const).map((st) => (
              <button
                key={st}
                className={`chip ${stage === st ? "on" : ""}`}
                aria-pressed={stage === st}
                onClick={() => {
                  speaker.unlock();
                  dispatch({ type: "setStage", stage: st, now: Date.now() });
                }}
              >
                {STAGE_LABEL[st]}
              </button>
            ))}
          </div>
        </div>
      )}
      <main>
        {tab === "draft" && <DraftTab plan={plan} hero={hero} laneOpponentId={laneOpponentId} onStart={() => setTab("live")} />}
        {tab === "live" && <LiveTab plan={plan} hero={hero} gameSec={gameSec} laneOpponentId={laneOpponentId} lastRead={room?.lastRead} onRepeat={repeat} onDraft={() => setTab("draft")} />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <CaptureProvider>
        <Shell />
      </CaptureProvider>
    </StoreProvider>
  );
}
