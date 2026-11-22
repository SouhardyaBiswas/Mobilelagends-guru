import { useEffect, useMemo, useRef, useState } from "react";
import { speaker } from "./audio/speech";
import { Ticker } from "./capture/ticker";
import { heroById } from "./data/heroes";
import { planBuild } from "./engine/build";
import { enemyStates, gameSeconds, StoreProvider, useStore } from "./state/store";
import { CaptureProvider } from "./ui/CaptureContext";
import { DraftTab } from "./ui/DraftTab";
import { LiveTab } from "./ui/LiveTab";
import { SettingsTab } from "./ui/SettingsTab";
import { useCoach } from "./ui/useCoach";

type Tab = "draft" | "live" | "settings";
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
          })
        : undefined,
    // The plan depends on these session fields only; the ticking clock must not rebuild it every second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hero, session.lane, session.enemies, session.enemyLive, session.manualFed, session.owned, session.gold, session.phase, late],
  );
  const repeat = useCoach(plan, hero, gameSec);

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

      <main>
        {tab === "draft" && <DraftTab plan={plan} hero={hero} onStart={() => setTab("live")} />}
        {tab === "live" && <LiveTab plan={plan} hero={hero} gameSec={gameSec} onRepeat={repeat} onDraft={() => setTab("draft")} />}
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
