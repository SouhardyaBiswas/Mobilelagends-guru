import { HEROES, heroById, synergy, versus } from "../data/heroes";
import type { CounterPick, Hero, Lane } from "../types";

export interface DraftInput {
  enemies: number[];
  allies: number[];
  banned?: number[];
  /** Only suggest heroes that play this lane. */
  lane?: Lane;
  /** The enemy you will face in lane — that matchup counts double. */
  laneOpponent?: number;
  limit?: number;
}

const fmt = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

/**
 * Rank picks against the enemy draft.
 *
 * Score is in win-rate points: the sum of this hero's measured edge over each
 * enemy (Moonton ranked stats), plus half-weight synergy with allies, a small
 * nudge for heroes that are strong in the current patch, and a bonus when the
 * game's own hero notes name the matchup.
 */
export function rankCounters(input: DraftInput): CounterPick[] {
  const taken = new Set([...input.enemies, ...input.allies, ...(input.banned ?? [])]);
  const enemies = input.enemies.map(heroById).filter((h): h is Hero => !!h);
  const allies = input.allies.map(heroById).filter((h): h is Hero => !!h);

  const picks: CounterPick[] = [];
  for (const hero of HEROES) {
    if (taken.has(hero.id)) continue;
    if (input.lane && !hero.lanes.includes(input.lane)) continue;

    let score = 0;
    const edges: Array<{ text: string; value: number }> = [];

    for (const enemy of enemies) {
      const stat = versus(hero.id, enemy.id);
      if (stat !== undefined) {
        // You spend the first minutes alone with your lane opponent, so that matchup weighs double.
        const inLane = enemy.id === input.laneOpponent;
        const value = inLane ? stat * 2 : stat;
        score += value;
        if (Math.abs(stat) >= 1) edges.push({ text: `${fmt(stat)} win rate vs ${enemy.name}${inLane ? " (your lane)" : ""}`, value });
      }
      // Moonton's editorial notes: "X is strong against …" / "Y is weak against …".
      if (hero.relation.strong?.ids.includes(enemy.id)) {
        score += 1.5;
        edges.push({ text: hero.relation.strong.desc, value: 1.5 });
      } else if (enemy.relation.weak?.ids.includes(hero.id)) {
        score += 1.5;
        edges.push({ text: enemy.relation.weak.desc, value: 1.5 });
      }
      if (hero.relation.weak?.ids.includes(enemy.id)) {
        score -= 1.5;
        edges.push({ text: `Careful: ${hero.relation.weak.desc}`, value: -1.5 });
      }
    }

    for (const ally of allies) {
      const syn = synergy(hero.id, ally.id);
      if (syn !== undefined) {
        score += syn * 0.5;
        if (syn >= 1.5) edges.push({ text: `${fmt(syn)} win rate alongside ${ally.name}`, value: syn * 0.5 });
      }
    }

    // Patch strength: a 53% win-rate hero gets +0.9, a 47% one gets -0.9.
    score += (hero.meta.win - 50) * 0.3;

    const reasons = edges
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .map((e) => e.text)
      .filter((text, i, all) => all.indexOf(text) === i)
      .slice(0, 3);
    if (!reasons.length) reasons.push(`${hero.meta.win.toFixed(1)}% win rate this patch — no strong matchup data either way`);
    picks.push({ hero, score, reasons });
  }

  return picks.sort((a, b) => b.score - a.score).slice(0, input.limit ?? 8);
}

/** Enemy heroes that are worth banning or avoiding against a hero you want to play. */
export function hardestMatchups(heroId: number, limit = 5): Array<{ hero: Hero; delta: number }> {
  return HEROES.map((h) => ({ hero: h, delta: versus(heroId, h.id) }))
    .filter((e): e is { hero: Hero; delta: number } => e.delta !== undefined && e.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, limit);
}
