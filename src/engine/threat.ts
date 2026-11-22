import { heroById } from "../data/heroes";
import type { Hero, PlayerState, Role, ThreatProfile, ThreatSource } from "../types";

/** How much of a team's kill pressure a role normally carries. */
const ROLE_PRESSURE: Record<Role, number> = {
  Marksman: 1,
  Mage: 1,
  Assassin: 1,
  Fighter: 0.8,
  Support: 0.4,
  Tank: 0.4,
};

function basePressure(hero: Hero): number {
  const role = ROLE_PRESSURE[hero.roles[0] ?? "Fighter"];
  // Blend the role prior with the hero's own offense rating (0..100).
  return role * (0.5 + 0.5 * (hero.ability.offense / 100));
}

/**
 * Multiplier for how far ahead a player is. Uses gold when the scoreboard shows
 * it (the best signal), otherwise kills minus deaths. 1 = even.
 */
export function fedFactor(p: PlayerState, teamAvgGold: number | undefined): number {
  let f = 1;
  if (p.gold !== undefined && teamAvgGold && teamAvgGold > 0) {
    f *= Math.pow(p.gold / teamAvgGold, 1.5);
  }
  if (p.kills !== undefined && p.deaths !== undefined) {
    f *= 1 + 0.09 * (p.kills - p.deaths);
  }
  return Math.max(0.45, Math.min(2.6, f));
}

const top = (scored: Array<[number, number]>, min: number): number[] =>
  scored
    .filter(([, v]) => v >= min)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

/**
 * Summarise what the enemy team threatens you with. With live scoreboard stats
 * the picture is re-weighted toward whoever is fed — that is the "improvise"
 * part: the right item depends on who is actually killing you, not on the draft.
 */
export function analyzeThreat(enemies: PlayerState[]): ThreatProfile {
  const known = enemies
    .map((p) => ({ p, hero: heroById(p.heroId) }))
    .filter((e): e is { p: PlayerState; hero: Hero } => !!e.hero);

  const golds = known.map((e) => e.p.gold).filter((g): g is number => g !== undefined);
  const avgGold = golds.length ? golds.reduce((a, b) => a + b, 0) / golds.length : undefined;
  const live = known.some((e) => e.p.gold !== undefined || e.p.kills !== undefined);

  const weighted = known.map((e) => {
    const fed = fedFactor(e.p, avgGold);
    return { ...e, fed, w: basePressure(e.hero) * fed };
  });
  const total = weighted.reduce((a, e) => a + e.w, 0) || 1;

  let phys = 0;
  let magic = 0;
  for (const e of weighted) {
    if (e.hero.damage === "physical") phys += e.w;
    else if (e.hero.damage === "magic") magic += e.w;
    else {
      phys += e.w / 2;
      magic += e.w / 2;
    }
  }
  const dmgTotal = phys + magic || 1;

  // Count-like sums: each enemy contributes its trait, scaled by how fed they are.
  const sum = (f: (h: Hero) => number) => weighted.reduce((a, e) => a + f(e.hero) * Math.min(1.6, e.fed), 0);
  const ids = (f: (h: Hero) => number, min: number) => top(weighted.map((e) => [e.hero.id, f(e.hero)]), min);

  // "Fed" needs a real lead, not just a ratio: two early kills are not worth changing a build over.
  const realLead = (p: PlayerState) =>
    (p.gold !== undefined && avgGold !== undefined && p.gold - avgGold >= 700) || (p.kills ?? 0) - (p.deaths ?? 0) >= 3;
  const sources: ThreatSource[] = weighted
    .map((e) => ({ heroId: e.hero.id, weight: e.w / total, fed: e.fed >= 1.35 && realLead(e.p) }))
    .sort((a, b) => b.weight - a.weight);

  return {
    physShare: phys / dmgTotal,
    magicShare: magic / dmgTotal,
    sustain: sum((h) => h.traits.sustain),
    shields: sum((h) => h.traits.shields),
    burst: sum((h) => h.traits.burst),
    basicAttack: sum((h) => h.traits.basicAttacker),
    crit: sum((h) => (h.traits.crit ? 1 : 0)),
    cc: sum((h) => h.traits.cc),
    tankiness: sum((h) => h.traits.tanky),
    trueDamage: sum((h) => (h.traits.trueDamage ? 1 : 0)),
    sources,
    who: {
      sustain: ids((h) => h.traits.sustain, 0.5),
      burst: ids((h) => h.traits.burst, 0.7),
      basicAttack: ids((h) => h.traits.basicAttacker, 0.55),
      cc: ids((h) => h.traits.cc, 0.7),
      tankiness: ids((h) => h.traits.tanky, 0.75),
      crit: ids((h) => (h.traits.crit ? 1 : 0), 1),
      magic: weighted.filter((e) => e.hero.damage === "magic").sort((a, b) => b.w - a.w).map((e) => e.hero.id),
      physical: weighted.filter((e) => e.hero.damage === "physical").sort((a, b) => b.w - a.w).map((e) => e.hero.id),
    },
    live,
  };
}
