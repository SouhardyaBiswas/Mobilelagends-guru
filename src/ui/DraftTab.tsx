import { useMemo, useState } from "react";
import { speaker } from "../audio/speech";
import { heroById } from "../data/heroes";
import { counterAdvice } from "../engine/coach";
import { rankCounters } from "../engine/draft";
import { useStore } from "../state/store";
import { LANE_LABEL, LANES, type BuildPlan, type Hero } from "../types";
import { demoRoster } from "../vision/demo";
import { BuildList, SpellEmblem } from "./BuildList";
import { HeroIcon, HeroPicker, TeamRow } from "./HeroBits";

export function DraftTab({ plan, hero, onStart }: { plan?: BuildPlan; hero?: Hero; onStart: () => void }) {
  const { state, dispatch } = useStore();
  const s = state.session;
  const [pickingMe, setPickingMe] = useState(false);
  const taken = useMemo(
    () => [...s.enemies, ...s.allies, ...s.banned, ...(s.myHeroId ? [s.myHeroId] : [])],
    [s.enemies, s.allies, s.banned, s.myHeroId],
  );
  const picks = useMemo(
    () => rankCounters({ enemies: s.enemies, allies: s.allies, banned: s.banned, lane: s.lane, limit: 8 }),
    [s.enemies, s.allies, s.banned, s.lane],
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

        {s.enemies.length > 0 && (
          <>
            <span className="eyebrow">Best into this enemy team{s.lane ? ` · ${LANE_LABEL[s.lane]}` : ""}</span>
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
            <p className="fine">Score = win-rate points gained versus these enemies in ranked play (Moonton stats), plus team synergy and patch strength.</p>
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
    </div>
  );
}
