import { useMemo, useState } from "react";
import { itemIcon } from "../data/items";
import { heroById } from "../data/heroes";
import { briefOn, gamePlan, type HeroBrief } from "../engine/tips";
import type { Hero, ThreatProfile } from "../types";
import { HeroIcon } from "./HeroBits";

/** Picture of an item or component, so it can be recognised in the shop without knowing its name. */
export function ItemIcon({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = itemIcon(id);
  const style = { width: size, height: size };
  if (!src || broken) {
    return (
      <span className="item-icon fallback" style={{ ...style, fontSize: Math.round(size * 0.34) }} aria-hidden>
        {name.slice(0, 2)}
      </span>
    );
  }
  return <img className="item-icon" style={style} src={`./${src}`} alt={name} onError={() => setBroken(true)} />;
}

export function BriefCard({ brief, open = false, lane = false }: { brief: HeroBrief; open?: boolean; lane?: boolean }) {
  const { hero, edge } = brief;
  return (
    <details className={`brief ${lane ? "lane" : ""}`} open={open}>
      <summary>
        <HeroIcon hero={hero} size={44} />
        <span className="brief-head">
          <span className="brief-name">
            {hero.name}
            {lane && <span className="tag nexttag">your lane</span>}
            {edge !== undefined && Math.abs(edge) >= 1 && (
              <span className={`score ${edge < 0 ? "neg" : ""}`} title="Your hero's win-rate edge in this matchup (ranked stats)">
                {edge > 0 ? "+" : ""}
                {edge.toFixed(1)}%
              </span>
            )}
          </span>
          <span className="brief-sum">{brief.summary}</span>
        </span>
      </summary>
      {brief.watch.length > 0 && (
        <div className="brief-block">
          <span className="eyebrow">Skills to recognise</span>
          <ul className="skills">
            {brief.watch.map((sk) => (
              <li key={sk.name}>
                <strong>{sk.name}</strong>
                <span className="skill-meta">
                  {sk.slot}
                  {sk.cd ? ` · ${Math.round(sk.cd)}s` : ""} · {sk.kind}
                </span>
                <span className="skill-text">{sk.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {brief.how.length > 0 && (
        <div className="brief-block">
          <span className="eyebrow">How to play against {hero.name}</span>
          <ul className="how">
            {brief.how.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {brief.note && <p className="fine">What beats them: {brief.note}</p>}
    </details>
  );
}

/** The pieces of the guide: the game plan, the "who is in your lane?" chips, the lane opponent's card, the other enemies' cards. */
export type GuidePart = "plan" | "picker" | "lane" | "others";
const ALL_PARTS: readonly GuidePart[] = ["plan", "picker", "lane", "others"];

interface GuideProps {
  me: Hero;
  enemies: number[];
  threat: ThreatProfile;
  laneOpponentId?: number;
  onPickLane: (id: number) => void;
  /** Which pieces to show, in this order. Everything by default; the wide dashboard splits them across columns. */
  parts?: readonly GuidePart[];
}

/** The new-player view: what this game is about, then each enemy in plain language. */
export function Guide({ me, enemies, threat, laneOpponentId, onPickLane, parts = ALL_PARTS }: GuideProps) {
  const plan = useMemo(() => gamePlan(me, enemies, threat, laneOpponentId), [me, enemies, threat, laneOpponentId]);
  const briefs = useMemo(
    () =>
      enemies
        .map(heroById)
        .filter((h): h is Hero => !!h)
        .map((h) => briefOn(h, me))
        // Lane opponent first, then whoever threatens the most.
        .sort((a, b) => Number(b.hero.id === laneOpponentId) - Number(a.hero.id === laneOpponentId)),
    [enemies, me, laneOpponentId],
  );
  if (!enemies.length) return <p className="hint">Add the enemy heroes and this turns into a plan for the match.</p>;
  const section = (part: GuidePart) => {
    switch (part) {
      case "plan":
        return (
          <ol className="plan" key={part}>
            {plan.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        );
      case "picker":
        return (
          <div className="field" key={part}>
            <span className="eyebrow">Who is in your lane?</span>
            <div className="chips">
              {briefs.map((b) => (
                <button key={b.hero.id} className={`chip ${b.hero.id === laneOpponentId ? "on" : ""}`} onClick={() => onPickLane(b.hero.id)}>
                  {b.hero.name}
                </button>
              ))}
            </div>
          </div>
        );
      case "lane":
        return briefs.filter((b) => b.hero.id === laneOpponentId).map((b) => <BriefCard key={b.hero.id} brief={b} lane open />);
      case "others":
        return briefs.filter((b) => b.hero.id !== laneOpponentId).map((b) => <BriefCard key={b.hero.id} brief={b} />);
    }
  };
  return <div className="guide">{parts.map(section)}</div>;
}
