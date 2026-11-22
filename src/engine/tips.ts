import { templateFor } from "../data/builds";
import { heroById, versus } from "../data/heroes";
import { itemById } from "../data/items";
import rawSkills from "../data/generated/skills.json";
import type { Hero, Lane, ThreatProfile } from "../types";

export interface Skill {
  name: string;
  slot: string;
  cd?: number;
  tags: string[];
  /** First sentence of the in-game description, as Moonton wrote it. */
  text: string;
}

const SKILLS = rawSkills as unknown as Record<string, Skill[]>;
export const skillsOf = (heroId: number): Skill[] => SKILLS[heroId] ?? [];

export interface WatchSkill extends Skill {
  /** Why a new player should care about this one. */
  kind: string;
}

export interface HeroBrief {
  hero: Hero;
  /** One line: what kind of threat this is. */
  summary: string;
  /** The skills worth recognising, most dangerous first. */
  watch: WatchSkill[];
  /** Plain-language advice for playing against them. */
  how: string[];
  /** Ranked win-rate edge for the player's hero in this matchup, in points. */
  edge?: number;
  /** Moonton's own note on what this hero struggles against. */
  note?: string;
}

const KIND: Array<[tag: string, kind: string, weight: number]> = [
  ["CC", "Crowd control — locks you in place", 5],
  ["Burst", "Burst damage", 4],
  ["Conceal", "Goes invisible", 4],
  ["Invincible", "Cannot be hurt while active", 3],
  ["Death Immunity", "Cannot die while active", 3],
  ["Mobility", "Dash — gap closer or escape", 2],
  ["Heal", "Healing", 2],
  ["Shield", "Shield", 2],
  ["Summon", "Summons something to fight", 1],
];

function watchList(hero: Hero, max = 3): WatchSkill[] {
  const scored = skillsOf(hero.id).map((sk) => {
    const hit = KIND.filter(([tag]) => sk.tags.includes(tag)).sort((a, b) => b[2] - a[2])[0];
    // The ultimate always matters: fights are decided by whether it is up.
    const base = sk.slot === "Ultimate" ? 3 : 0;
    return { sk, kind: hit?.[1] ?? (sk.slot === "Ultimate" ? "Their ultimate" : ""), score: base + (hit?.[2] ?? 0) };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ sk, kind }) => ({ ...sk, kind }));
}

const squishy = (h: Hero) => h.ability.durability < 50 && h.roles[0] !== "Tank";
const ranged = (h: Hero) => h.roles[0] === "Marksman" || h.roles[0] === "Mage";
const names = (skills: Skill[]) => skills.map((s) => s.name).join(" and ");

function summarise(h: Hero): string {
  const t = h.traits;
  const bits: string[] = [];
  if (t.burst >= 0.7) bits.push("kills fast in one combo");
  if (t.cc >= 0.7) bits.push("lots of crowd control");
  if (t.sustain >= 0.6) bits.push("heals a lot");
  else if (t.shields >= 0.6) bits.push("shields");
  if (t.mobility >= 0.6) bits.push("very mobile");
  if (t.basicAttacker >= 0.6) bits.push("damage comes from basic attacks");
  if (t.tanky >= 0.75) bits.push("hard to kill");
  if (t.poke) bits.push("pokes from range");
  if (t.conceal) bits.push("can go invisible");
  const dmg = h.damage === "mixed" ? "Mixed-damage" : h.damage === "magic" ? "Magic" : "Physical";
  const role = h.roles.join(" / ").toLowerCase();
  return `${dmg} ${role}${bits.length ? ` — ${bits.slice(0, 3).join(", ")}` : ""}.`;
}

/**
 * Everything a new player should know about one enemy. Skill names and
 * descriptions come from the synced game data; the advice is derived from what
 * the kit does (crowd control, burst, healing…), not from memory of the hero.
 */
export function briefOn(enemy: Hero, me?: Hero): HeroBrief {
  const t = enemy.traits;
  const skills = skillsOf(enemy.id);
  const cc = skills.filter((s) => s.tags.includes("CC"));
  const dashes = skills.filter((s) => s.tags.includes("Mobility"));
  const ult = skills.find((s) => s.slot === "Ultimate");
  const how: string[] = [];

  if (cc.length) {
    how.push(`Their kills start with ${names(cc.slice(0, 2))}. Keep moving side to side, and fight right after they miss it${cc[0]?.cd ? ` — it is down for about ${Math.round(cc[0].cd)} seconds` : ""}.`);
  }
  if (t.burst >= 0.7 && (!me || squishy(me))) {
    how.push("They can kill you in one combo. Stay near your tank or under your turret, and never walk alone into a bush or the river.");
  }
  if (t.conceal) how.push("They can go invisible. When they vanish from the map, assume they are next to you and stay with a teammate.");
  if (t.mobility >= 0.6 && dashes.length) {
    how.push(`They close the gap with ${names(dashes.slice(0, 2))}. Keep your own escape or Flicker until after they have used it.`);
  }
  if (t.sustain >= 0.6 || t.shields >= 0.6) {
    const antiheal = me ? itemById(templateFor(me, me.lanes[0]).antiheal)?.name : undefined;
    how.push(`Long fights favour them because they ${t.sustain >= 0.6 ? "heal" : "shield"}. ${antiheal ? `Buy ${antiheal} to cut it, and ` : "Buy anti-heal, and "}hit them hard in short bursts instead of trading slowly.`);
  }
  if (t.basicAttacker >= 0.6 && enemy.roles[0] === "Marksman") {
    how.push("Weak early, dangerous with items. Pressure them before they finish two items; later, don't face them without your team.");
  }
  if (t.poke) how.push("They poke from range. Step sideways to dodge, don't fight at half health, and go in when their skills are on cooldown.");
  if (t.tanky >= 0.75) how.push("Hard to kill. In team fights hit their damage dealers first unless this is the only hero in reach.");
  // Only true of heroes who must walk up to hit you; supports are often ranged too.
  const melee = ["Fighter", "Assassin", "Tank"].includes(enemy.roles[0] ?? "");
  if (me && ranged(me) && melee) how.push("You out-range them. Hit them when they step up to the minions, and back off before they reach you.");
  if (me && me.traits.burst >= 0.7 && squishy(enemy)) how.push("You can kill them with one full combo. Wait in a bush and open on them when they walk past.");
  if (ult?.cd && ult.cd >= 30) how.push(`${ult.name} is their ultimate (about ${Math.round(ult.cd)} seconds). Once they have used it they are much weaker — that is your window.`);

  const edge = me ? versus(me.id, enemy.id) : undefined;
  return { hero: enemy, summary: summarise(enemy), watch: watchList(enemy), how: how.slice(0, 4), edge, note: enemy.relation.weak?.desc };
}

const LANE_MATCH: Record<Lane, Lane[]> = { gold: ["gold"], exp: ["exp"], mid: ["mid"], jungle: ["jungle"], roam: ["roam"] };

/** Best guess at who the player meets in lane: the enemy whose main lane matches theirs. */
export function guessLaneOpponent(myLane: Lane | undefined, enemyIds: number[]): number | undefined {
  if (!myLane) return undefined;
  const enemies = enemyIds.map(heroById).filter((h): h is Hero => !!h);
  const want = LANE_MATCH[myLane];
  const primary = enemies.find((h) => h.lanes[0] && want.includes(h.lanes[0]));
  return (primary ?? enemies.find((h) => h.lanes.some((l) => want.includes(l))))?.id;
}

const JOB: Record<string, string> = {
  Marksman: "Your job: farm safely until you have two or three items, then stand behind your tank and hit whoever is closest.",
  Mage: "Your job: clear the mid wave fast, help the side lanes, and land your skills on their damage dealers from the back.",
  Assassin: "Your job: farm the jungle, then pick off their marksman or mage when they are alone. Don't go in first.",
  Fighter: "Your job: win or hold your lane, then dive their back line once your tank has started the fight.",
  Tank: "Your job: go in first, soak up their big skills, and keep enemies off your marksman.",
  Support: "Your job: stay with your marksman early, keep your team alive, and save your big skill for the fight that matters.",
};

/** A short game plan for a new player: who to kill, who to respect, what the team needs from them. */
export function gamePlan(me: Hero, enemyIds: number[], threat: ThreatProfile, laneOpponentId?: number): string[] {
  const enemies = enemyIds.map(heroById).filter((h): h is Hero => !!h);
  if (!enemies.length) return [JOB[me.roles[0] ?? "Fighter"] ?? ""];
  const out: string[] = [];
  const list = (hs: Hero[]) => hs.map((h) => h.name).join(" and ");

  const lane = laneOpponentId ? heroById(laneOpponentId) : undefined;
  if (lane) {
    const edge = versus(me.id, lane.id);
    const read = edge === undefined ? "" : edge >= 1 ? ` The numbers favour you (+${edge.toFixed(1)}% win rate).` : edge <= -1 ? ` This lane is hard for ${me.name} (${edge.toFixed(1)}% win rate) — farm safely and don't take even fights.` : "";
    out.push(`In lane you face ${lane.name}: ${summarise(lane).replace(/\.$/, "").toLowerCase()}.${read}`);
  }

  // Who to focus: fragile damage dealers if they have any, otherwise the healers keeping everyone else alive.
  const carries = enemies.filter((h) => squishy(h) && h.roles[0] !== "Support").sort((a, b) => b.ability.offense - a.ability.offense).slice(0, 2);
  const healers = enemies.filter((h) => h.roles[0] === "Support" && h.traits.sustain >= 0.5).slice(0, 2);
  const targets = carries.length ? carries : healers;
  if (carries.length) out.push(`Kill first: ${list(carries)} — their damage, and easy to kill.`);
  else if (healers.length) out.push(`Kill first: ${list(healers)} — their healers. While they live, nobody else dies.`);

  // At most two warnings, most actionable first, so the plan stays short enough to remember.
  const warnings: string[] = [];
  if (threat.sustain + 0.5 * threat.shields >= 1.2) warnings.push("They heal and shield a lot — someone on your team needs anti-heal early. It is in your build.");
  const divers = (threat.who.burst ?? []).map(heroById).filter((h): h is Hero => !!h).slice(0, 2);
  if (divers.length && squishy(me)) warnings.push(`${list(divers)} will try to jump on you. Stay behind your team and keep your escape ready.`);
  if (threat.cc >= 2.2) warnings.push("They have a lot of crowd control. Don't bunch up with teammates, and don't be the first one in.");
  const walls = enemies.filter((h) => h.traits.tanky >= 0.75).slice(0, 2);
  if (walls.length && targets.length) warnings.push(`Don't waste skills on ${list(walls)} while ${targets[0]!.name} is alive.`);
  out.push(...warnings.slice(0, 2));

  out.push(JOB[me.roles[0] ?? "Fighter"] ?? "");
  return out.filter(Boolean).slice(0, 5);
}
