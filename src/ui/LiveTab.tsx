import { useMemo, useRef } from "react";
import { speaker } from "../audio/speech";
import { captureSupport } from "../capture/capture";
import { heroById } from "../data/heroes";
import { componentId, ownedLabel } from "../data/items";
import { formatClock, upcoming } from "../data/timeline";
import { matchStory } from "../engine/story";
import { useStore } from "../state/store";
import type { BuildPlan, Hero, ThreatProfile } from "../types";
import { BuildList, SpellEmblem } from "./BuildList";
import { useCapture } from "./CaptureContext";
import { Guide, ItemIcon } from "./Guide";
import { HeroIcon } from "./HeroBits";

type Plan = BuildPlan & { threat: ThreatProfile };

const ACTION_LABEL: Record<Plan["next"]["action"], string> = {
  buy: "Buy now",
  "buy-component": "Buy the first piece",
  save: "Save up",
  "sell-swap": "Sell and swap",
  done: "Build complete",
};

function NowCard({ plan, onRepeat }: { plan: Plan; onRepeat: () => void }) {
  const { state, dispatch } = useStore();
  const n = plan.next;
  const confirm = () => {
    if (n.action === "sell-swap" && n.sell && n.item) dispatch({ type: "swap", sell: n.sell.id, buy: n.item.id });
    else if (n.action === "buy-component" && n.component) dispatch({ type: "bought", id: componentId(n.component.name) });
    else if (n.item) dispatch({ type: "bought", id: n.item.id });
  };
  const target = n.action === "buy-component" || (n.action === "save" && n.component) ? n.component : n.item;
  return (
    <section className={`now action-${n.action}`} aria-live="polite">
      <span className="eyebrow">{ACTION_LABEL[n.action]}</span>
      <div className="now-main">
        {target && <ItemIcon id={n.component && target === n.component ? componentId(n.component.name) : (n.item?.id ?? "")} name={target.name} size={84} />}
        <h1>{n.say}</h1>
      </div>
      <p>{n.detail}</p>
      {n.where && <p className="where">🛒 {n.where}</p>}
      <div className="row">
        {n.action !== "done" && n.action !== "save" && (
          <button className="btn primary" onClick={confirm}>
            ✓ Done{target ? ` — got ${target.name}` : ""}
          </button>
        )}
        {n.action === "save" && n.item && (
          <button className="btn" onClick={confirm}>
            I bought {n.item.name} anyway
          </button>
        )}
        <button className="btn ghost" onClick={onRepeat} disabled={!state.settings.speech.enabled}>
          🔊 Say again
        </button>
      </div>
    </section>
  );
}

function ThreatPanel({ plan }: { plan: Plan }) {
  const { state, dispatch } = useStore();
  const s = state.session;
  const t = plan.threat;
  const chips: string[] = [];
  if (t.sustain + 0.5 * t.shields >= 1.2) chips.push("Heavy healing / shields");
  if (t.burst >= 1.5) chips.push("Burst");
  if (t.cc >= 2.2) chips.push("Lots of crowd control");
  if (t.tankiness >= 2.2) chips.push("Tanky");
  if (t.basicAttack >= 1.2) chips.push("Basic attackers");
  const magicPct = Math.round(t.magicShare * 100);

  return (
    <section className="panel">
      <h2>Enemy team</h2>
      {!s.enemies.length && <p className="hint">No enemies known yet. Add them in Draft, or open the scoreboard so the app can read them.</p>}
      {s.enemies.length > 0 && (
        <>
          <div className="split" title="Share of enemy damage, weighted by who is ahead">
            <i className="phys" style={{ width: `${100 - magicPct}%` }}>{100 - magicPct >= 18 ? `Physical ${100 - magicPct}%` : ""}</i>
            <i className="magic" style={{ width: `${magicPct}%` }}>{magicPct >= 18 ? `Magic ${magicPct}%` : ""}</i>
          </div>
          <div className="chips static">{chips.map((c) => <span key={c} className="chip on">{c}</span>)}</div>
          <ul className="enemies">
            {t.sources.map((src) => {
              const hero = heroById(src.heroId);
              if (!hero) return null;
              const live = s.enemyLive[src.heroId];
              const mark = s.manualFed[src.heroId];
              return (
                <li key={src.heroId} className={src.fed ? "fed" : ""}>
                  <HeroIcon hero={hero} size={40} />
                  <span className="enemy-main">
                    <span className="enemy-name">
                      {hero.name}
                      <span className={`tag dmg-${hero.damage}`}>{hero.damage}</span>
                      {src.fed && <span className="tag fedtag">fed</span>}
                    </span>
                    <span className="bar"><i style={{ width: `${Math.round(src.weight * 100 * 2.2)}%` }} /></span>
                    <small>
                      {live?.kills !== undefined ? `${live.kills}/${live.deaths ?? "?"}/${live.assists ?? "?"}` : "no live stats"}
                      {live?.gold !== undefined ? ` · ${live.gold} gold` : ""}
                      {live?.items?.length ? ` · ${live.items.map(ownedLabel).join(", ")}` : ""}
                    </small>
                  </span>
                  {!live && (
                    <button className={`btn tiny ${mark === 1 ? "hot" : mark === -1 ? "cold" : ""}`} onClick={() => dispatch({ type: "cycleFed", heroId: src.heroId })} title="Mark this enemy as fed or behind">
                      {mark === 1 ? "Fed" : mark === -1 ? "Behind" : "Even"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="fine">The bar is each enemy's share of their team's kill pressure. Without live stats, tap Even to mark someone as fed or behind.</p>
        </>
      )}
    </section>
  );
}

/** The match's memory: how the game has moved across every scoreboard read so far. */
function StoryPanel() {
  const { state } = useStore();
  const story = useMemo(() => matchStory(state.session), [state.session]);
  if (!story) {
    return (
      <section className="panel">
        <h2>Match so far</h2>
        <p className="hint">Open the scoreboard and send a screenshot. From then on every scoreboard is remembered, so the coach can tell who is pulling ahead and who is falling behind.</p>
      </section>
    );
  }
  const g = story.teamGold;
  const minePct = g ? Math.round((g.mine / Math.max(1, g.mine + g.theirs)) * 100) : 50;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Match so far</h2>
        <small>{story.readings} scoreboard{story.readings === 1 ? "" : "s"} remembered</small>
      </div>
      {g && (
        <div className="split" title="Total gold of each team">
          <i className="ally-side" style={{ width: `${minePct}%` }}>You {(g.mine / 1000).toFixed(1)}k</i>
          <i className="enemy-side" style={{ width: `${100 - minePct}%` }}>Them {(g.theirs / 1000).toFixed(1)}k</i>
        </div>
      )}
      <ul className="how">
        {story.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <table className="standings">
        <tbody>
          {story.players.map((p) => {
            const hero = heroById(p.heroId);
            if (!hero) return null;
            return (
              <tr key={p.heroId} className={`side-${p.side}`}>
                <td><HeroIcon hero={hero} size={28} /></td>
                <td className="who">{hero.name}{p.side === "me" && <span className="tag nexttag">you</span>}</td>
                <td className="num">{p.kills ?? "–"}/{p.deaths ?? "–"}/{p.assists ?? "–"}</td>
                <td className="num">{p.gold ?? "–"}</td>
                <td className="num gain">{p.gain !== undefined ? `+${p.gain}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="fine">Gold is each player's total earned, richest first. The last column is what they gained since an earlier scoreboard.</p>
    </section>
  );
}

function CapturePanel() {
  const { state } = useStore();
  const { status, start, stop, analyzeNow, analyzeFile } = useCapture();
  const fileRef = useRef<HTMLInputElement>(null);
  const support = captureSupport();
  const { vision, capture } = state.settings;
  const providerName = vision.provider === "demo" ? "Demo (scripted match, no API key)" : vision.provider === "claude" ? `Claude · ${vision.claudeModel}` : `Gemini · ${vision.geminiModel}`;
  const still = status.motion < capture.stillThreshold * (status.kind === "camera" ? 2.5 : 1);

  return (
    <section className="panel">
      <h2>Screen reader</h2>
      <p className="fine">Reads the scoreboard, shop, draft and loading screens. Using: {providerName}.</p>
      <div className="row wrap">
        {!status.active ? (
          <>
            <button className="btn primary" disabled={!support.screen} onClick={() => void start("screen")} title={support.screen ? "" : "Screen sharing is not available in this browser (phones and tablets)"}>
              🖥 Share game screen
            </button>
            <button className="btn" disabled={!support.camera} onClick={() => void start("camera")}>
              📷 Point camera at screen
            </button>
          </>
        ) : (
          <button className="btn" onClick={stop}>
            ■ Stop {status.kind === "camera" ? "camera" : "sharing"}
          </button>
        )}
        <button className="btn" onClick={() => fileRef.current?.click()}>
          ⬆ Upload screenshot
        </button>
        <button className="btn" onClick={analyzeNow} disabled={status.busy}>
          {status.busy ? "Reading…" : vision.provider === "demo" && !status.active ? "▶ Run demo step" : "Read now"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void analyzeFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {!support.screen && <p className="hint">This browser can't capture another app's screen. Use the camera on a second device, upload screenshots, or mirror the tablet to a laptop.</p>}
      {status.active && (
        <div className="meter" title="How much the picture is changing">
          <span>{capture.mode === "auto" ? (still ? "Screen is still — reading when it changes" : "Gameplay moving — waiting for a panel") : `Reading every ${capture.intervalSec}s`}</span>
          <span className="bar"><i className={still ? "ok" : ""} style={{ width: `${Math.min(100, status.motion * 6)}%` }} /></span>
        </div>
      )}
      {status.error && <p className="error">{status.error}</p>}
      {status.last && (
        <p className="fine">
          Last read: <strong>{status.last.screen}</strong> — {status.last.found} · {(status.last.ms / 1000).toFixed(1)}s
          {status.last.model ? ` · ${status.last.model}` : ""}
        </p>
      )}
      <p className="fine">
        {state.session.calls} of {capture.maxCalls} reads used this match
        {state.session.costUsd > 0 ? ` · about $${state.session.costUsd.toFixed(3)}` : ""}
      </p>
    </section>
  );
}

export function LiveTab({ plan, hero, gameSec, laneOpponentId, onRepeat, onDraft }: { plan?: Plan; hero?: Hero; gameSec?: number; laneOpponentId?: number; onRepeat: () => void; onDraft: () => void }) {
  const { state, dispatch } = useStore();
  const s = state.session;

  if ((!hero || !plan) && state.settings.sync.follow) {
    return (
      <div className="grid two">
        <section className="panel">
          <h2>Waiting for your iPad</h2>
          <p className="hint">This device is following room <strong>{state.settings.sync.room}</strong>. On the iPad, open the scoreboard in a match and run the coach shortcut. As soon as a screenshot is read, your build, the enemy team and the plan appear here and are spoken aloud.</p>
          <button className="btn primary" onClick={() => { speaker.unlock(); speaker.say("Voice is on. Waiting for your first screenshot.", 2); }}>🔊 Turn on voice for this device</button>
          <p className="fine">Phones only speak after you tap once, and only while this page stays open on screen.</p>
        </section>
      </div>
    );
  }
  if (!hero || !plan) {
    return (
      <div className="grid two">
        <section className="panel">
          <h2>Pick your hero to start</h2>
          <p className="hint">The coach needs to know who you're playing. Choose in Draft — or share your screen and open the loading screen or scoreboard, and it will work it out.</p>
          <button className="btn primary" onClick={onDraft}>Go to Draft</button>
        </section>
        <CapturePanel />
      </div>
    );
  }

  const soon = gameSec !== undefined ? upcoming(gameSec) : [];
  const now = Date.now();
  return (
    <div className="grid live">
      <div className="col">
        <NowCard plan={plan} onRepeat={onRepeat} />

        <section className="panel statusbar">
          <div className="stat">
            <span className="eyebrow">Match clock</span>
            <div className="row">
              <strong className="big">{gameSec !== undefined ? formatClock(gameSec) : "—"}</strong>
              <button className="btn tiny" onClick={() => dispatch({ type: "syncClock", now, gameSec: Math.max(0, (gameSec ?? 0) - 10) })}>−10s</button>
              <button className="btn tiny" onClick={() => dispatch({ type: "syncClock", now, gameSec: (gameSec ?? 0) + 10 })}>+10s</button>
              <button className="btn tiny" onClick={() => dispatch({ type: "syncClock", now, gameSec: 0 })}>0:00</button>
            </div>
            {soon[0] && <small>{soon.map((e) => `${e.label} ${formatClock(e.atSec)}`).join(" · ")}</small>}
          </div>
          <div className="stat">
            <span className="eyebrow">Your gold</span>
            <div className="row">
              <input
                className="input gold"
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="unknown"
                value={s.gold ?? ""}
                onChange={(e) => dispatch({ type: "setGold", gold: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
                aria-label="Your current gold"
              />
              <button className="btn tiny" onClick={() => dispatch({ type: "setGold", gold: (s.gold ?? 0) + 250 })}>+250</button>
              <button className="btn tiny" onClick={() => dispatch({ type: "setGold", gold: (s.gold ?? 0) + 1000 })}>+1000</button>
            </div>
            <small>Read from the screen when visible; type it for exact "buy now / save" calls.</small>
          </div>
        </section>

        <StoryPanel />

        <section className="panel">
          <div className="panel-head">
            <h2>{hero.name} — build path</h2>
            <button className="btn ghost" onClick={() => dispatch({ type: "backToDraft" })}>Edit draft</button>
          </div>
          <BuildList plan={plan} onToggle={(id) => dispatch({ type: "toggleOwned", id })} />
          <p className="fine">Tap an item to mark it owned. Items tagged "counter" were chosen for this enemy team and move as the game changes.</p>
          <SpellEmblem plan={plan} />
          {plan.bootsNote && <p className="hint">{plan.bootsNote}</p>}
        </section>
      </div>

      <div className="col">
        <section className="panel">
          <h2>How to play this game</h2>
          <Guide me={hero} enemies={s.enemies} threat={plan.threat} laneOpponentId={laneOpponentId} onPickLane={(id) => dispatch({ type: "setLaneOpponent", id })} />
        </section>
        <ThreatPanel plan={plan} />
        <CapturePanel />
        <section className="panel">
          <h2>Coach log</h2>
          {!s.log.length && <p className="hint">Everything the coach says or reads shows up here.</p>}
          <ul className="log">
            {s.log.slice(0, 14).map((e, i) => (
              <li key={`${e.at}-${i}`} className={`log-${e.kind}`}>
                <time>{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
