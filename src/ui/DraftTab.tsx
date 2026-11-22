import { useMemo, useState } from "react";
import { speaker } from "../audio/speech";
import { heroById } from "../data/heroes";
import { counterAdvice } from "../engine/coach";
import { rankCounters } from "../engine/draft";
import { useStore } from "../state/store";
import { LANE_LABEL, LANES, type BuildPlan, type Hero, type ThreatProfile } from "../types";
import { demoRoster } from "../vision/demo";
import { BuildList, SpellEmblem } from "./BuildList";
import { Guide } from "./Guide";
import { HeroIcon, HeroPicker, TeamRow } from "./HeroBits";

export function DraftTab({ plan, hero, laneOpponentId, onStart }: { plan?: BuildPlan & { threat: ThreatProfile }; hero?: Hero; laneOpponentId?: number; onStart: () => void }) {
  const { state, dispatch } = useStore();
  const s = state.session;
  const [pickingMe, setPickingMe] = useState(false);
  const taken = useMemo(
    () => [...s.enemies, ...s.allies, ...s.banned, ...(s.myHeroId ? [s.myHeroId] : [])],
    [s.enemies, s.allies, s.banned, s.myHeroId],
  );
  const picks = useMemo(
    () => rankCounters({ enemies: s.enemies, allies: s.allies, banned: s.banned, lane: s.lane, laneOpponent: laneOpponentId, limit: 8 }),
    [s.enemies, s.allies, s.banned, s.lane, laneOpponentId],
  );
  const best = Math.max(1, ...picks.map((p) => p.score));

  return (
    <div className="grid two">
      <section className="panel">
        <h2>1 · The draft</h2>
        <TeamRow label="Enemy team" tone="enemy" max={5} ids={s.enemies} exclude={taken} onChange={(ids) => dispatch({ type: "setTeam", side: "enemies", ids })} />
        <TeamRow label="Your teammates" tone="ally" max={4} ids={s.allies} exclude={taken} onChange={(ids) => dispatch({ type: "setTeam", side: "allies", ids })} />
        <TeamRow label="Banned" tone="ban" max={10} ids={s.banned} exclude={taken} onChange={(ids) => dispatch({ type: "setTeam", side: "banned", ids })} />

        <div className="field">
          <span className="eyebrow">Your lane</span>
          <div className="chips">
            {LANES.map((lane) => (
              <button key={lane} className={`chip ${s.lane === lane ? "on" : ""}`} onClick={() => dispatch({ type: "setLane", lane: s.lane === lane ? undefined : lane })}>
                {LANE_LABEL[lane]}
              </button>
            ))}
          </div>
        </div>

        {!s.enemies.length && (
          <p className="hint">
            Add enemy picks as they lock in and the best counters appear on the right.{" "}
            <button
              className="link"
              onClick={() => {
                const demo = demoRoster();
                dispatch({ type: "setTeam", side: "enemies", ids: demo.enemies });
                dispatch({ type: "setTeam", side: "allies", ids: demo.allies.slice(1) });
              }}
            >
              Load a sample draft
            </button>
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>2 · Your pick</h2>
          {picks.length > 0 && s.enemies.length > 0 && (
            <button
              className="btn ghost"
              onClick={() => {
                const advice = counterAdvice(picks);
                speaker.unlock();
                if (advice) speaker.say(advice.say, 2);
              }}
            >
              🔊 Read top 3
            </button>
          )}
        </div>

        <button className={`me-slot ${hero ? "filled" : ""}`} onClick={() => setPickingMe(true)}>
          {hero ? (
            <>
              <HeroIcon hero={hero} size={52} />
              <span>
                <strong>{hero.name}</strong>
                <small>{hero.roles.join(" / ")} · tap to change</small>
              </span>
            </>
          ) : (
            <span>
              <strong>Choose your hero</strong>
              <small>or tap a suggestion below</small>
            </span>
          )}
        </button>

        {s.enemies.length === 0 && (
          <p className="hint">
            <strong>Picking before the enemy?</strong> Take the hero you play best — comfort beats counters. Below are the strongest heroes this patch{s.lane ? ` for ${LANE_LABEL[s.lane].toLowerCase()}` : ""}. Once enemies lock in, this list re-ranks against them, and you get a plan for how to play.
          </p>
        )}
        {s.enemies.length > 0 && s.enemies.length < 5 && (
          <p className="hint">{s.enemies.length} of 5 enemies known. The more that have picked, the better the suggestion — the last pick sees everything.</p>
        )}
        {(
          <>
            <span className="eyebrow">{s.enemies.length ? `Best into this enemy team${s.lane ? ` · ${LANE_LABEL[s.lane]}` : ""}` : "Strong this patch"}</span>
            <ul className="counters">
              {picks.map((p) => (
                <li key={p.hero.id}>
                  <button className={`counter ${p.hero.id === s.myHeroId ? "on" : ""}`} onClick={() => dispatch({ type: "setMyHero", id: p.hero.id })}>
                    <HeroIcon hero={p.hero} />
                    <span className="counter-main">
                      <span className="counter-name">
                        {p.hero.name}
                        <span className={`score ${p.score < 0 ? "neg" : ""}`}>{p.score >= 0 ? "+" : ""}{p.score.toFixed(1)}</span>
                      </span>
                      <span className="bar"><i style={{ width: `${Math.max(4, (p.score / best) * 100)}%` }} /></span>
                      <span className="counter-why">{p.reasons[0]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="fine">Score = win-rate points gained versus these enemies in ranked play (Moonton stats), with your lane opponent counted double, plus team synergy and patch strength.</p>
          </>
        )}

        {pickingMe && (
          <HeroPicker
            title="Your hero"
            exclude={taken.filter((id) => id !== s.myHeroId)}
            onClose={() => setPickingMe(false)}
            onPick={(id) => {
              dispatch({ type: "setMyHero", id });
              setPickingMe(false);
            }}
          />
        )}
      </section>

      {hero && plan && (
        <section className="panel span">
          <div className="panel-head">
            <h2>3 · Plan for {hero.name}{s.enemies.length ? ` vs ${s.enemies.map((id) => heroById(id)?.name).join(", ")}` : ""}</h2>
            <button
              className="btn primary"
              onClick={() => {
                speaker.unlock();
                dispatch({ type: "startMatch", now: Date.now() });
                onStart();
              }}
            >
              Start match ▸
            </button>
          </div>
          <SpellEmblem plan={plan} />
          {plan.bootsNote && <p className="hint">{plan.bootsNote}</p>}
          <BuildList plan={plan} />
        </section>
      )}

      {hero && plan && (
        <section className="panel span">
          <h2>4 · How to play this game</h2>
          <Guide me={hero} enemies={s.enemies} threat={plan.threat} laneOpponentId={laneOpponentId} onPickLane={(id) => dispatch({ type: "setLaneOpponent", id })} />
        </section>
      )}
    </div>
  );
}
