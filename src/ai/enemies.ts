/**
 * The enemy-tracking specialist. It gets the latest scoreboard picture and the
 * match numbers, and answers per enemy: how dangerous they are right now, which
 * items it can actually make out in their row, and how to deal with them.
 *
 * Icon reading is where vision models go wrong, so an item is only believed once
 * two reads in a row name it; until then it is shown as a "maybe".
 */
import { findHero, heroById, heroName } from "../data/heroes";
import { findItem, itemById, ITEMS } from "../data/items";
import { skillsOf } from "../engine/tips";
import { gameSeconds, type Session } from "../state/session";
import type { EnemyIntel } from "../types";

export const ENEMY_SYSTEM = `You track the enemy team for a NEW player of Mobile Legends: Bang Bang. You are given the latest scoreboard screenshot (when there is one) and the match numbers as text. For each enemy hero, say how dangerous they are right now, which items they have built, and how the player should deal with them.

Reading the scoreboard picture
- The enemy team is the right-hand half. Each row has up to six round item icons.
- Name an item only when you clearly recognise its icon, using a name from the ITEM LIST exactly. A wrong item is worse than none: skip anything you are not sure of. Empty slots are empty.
- If no picture is given, or the rows cannot be made out, return empty item lists.

Judging threat
- From this match's kills, deaths and gold, not from the hero's reputation. "high" for whoever is clearly ahead (well above their team's average gold, or many more kills than deaths); "low" for whoever is behind; "medium" otherwise.

Notes
- One line per enemy, under 16 words, written to the player: what this hero will try to do to them and the simplest answer (keep distance, stay near the turret, wait for their dash, buy a named kind of defense).
- summary: one line under 18 words: who to respect, and who is weak enough to fight.

Use only hero names from the match state.

ITEM LIST
${ITEMS.map((i) => i.name).join(", ")}`;

export const ENEMY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    enemies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hero: { type: "string" },
          threat: { type: "string", enum: ["high", "medium", "low"] },
          items: { type: "array", items: { type: "string" } },
          note: { type: "string" },
        },
        required: ["hero", "threat", "items", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "enemies"],
  additionalProperties: false,
} as const;

/** The match numbers for the enemy tracker. Undefined before the enemy team is known. */
export function enemyBrief(s: Session, now: number, hasPicture: boolean): string | undefined {
  const me = s.myHeroId ? heroById(s.myHeroId) : undefined;
  if (!me || s.enemies.length < 3) return undefined;
  const sec = gameSeconds(s, now);
  const lines: string[] = [];
  lines.push(`The player is ${me.name} (${me.roles.join("/")}, ${me.damage} damage)${s.lane ? `, ${s.lane} lane` : ""}.${sec !== undefined ? ` Match clock: about ${Math.floor(sec / 60)} minutes.` : ""}`);
  const mine = s.allyLive[me.id];
  if (mine?.kills !== undefined) lines.push(`Their own line: ${mine.kills}/${mine.deaths ?? "?"}/${mine.assists ?? "?"}${mine.gold !== undefined ? `, ${mine.gold} gold` : ""}.`);
  lines.push("ENEMIES");
  const before = s.history.at(-2);
  for (const id of s.enemies) {
    const h = heroById(id);
    if (!h) continue;
    const p = s.enemyLive[id];
    const was = before?.players[id];
    const gained = p?.kills !== undefined && was?.kills !== undefined && p.kills > was.kills ? ` (+${p.kills - was.kills} kills since the last scoreboard)` : "";
    const skill = skillsOf(id).find((k) => k.slot === "Ultimate");
    lines.push(
      `- ${h.name} — ${h.roles.join("/")}, ${h.damage} damage. ${p?.kills !== undefined ? `${p.kills}/${p.deaths ?? "?"}/${p.assists ?? "?"}` : "no numbers yet"}${p?.gold !== undefined ? `, ${p.gold} gold` : ""}${gained}.` +
        (skill ? ` Ultimate — ${skill.name}: ${skill.text.slice(0, 100)}` : ""),
    );
  }
  const scenes = (s.scenes ?? []).slice(-3);
  if (scenes.length) lines.push("WHERE THE PLAYER HAS BEEN (from recent frames; hints only)", ...scenes.map((x) => `- ${x.text}`));
  lines.push(hasPicture ? "The scoreboard picture is attached." : "No scoreboard picture this time: judge from the numbers and return empty item lists.");
  return lines.join("\n");
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Check the tracker's answer: only enemies in this match, only catalog items, and
 * an item counts as known only if the previous read named it for that hero too.
 */
export function normalizeEnemies(raw: unknown, s: Session, previous: EnemyIntel | undefined, model: string, now: number): EnemyIntel | undefined {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(r.enemies) ? (r.enemies as Array<Record<string, unknown>>) : [];
  const enemies: EnemyIntel["enemies"] = [];
  for (const row of rows) {
    const hero = findHero(text(row?.hero, 40));
    if (!hero || !s.enemies.includes(hero.id) || enemies.some((e) => e.heroId === hero.id)) continue;
    const named: string[] = [];
    for (const name of Array.isArray(row.items) ? row.items.slice(0, 6) : []) {
      const found = findItem(text(name, 60));
      const item = found && !found.id.startsWith("comp:") ? itemById(found.id) : undefined;
      if (item && !named.includes(item.id)) named.push(item.id);
    }
    const before = previous?.enemies.find((e) => e.heroId === hero.id);
    const seenBefore = new Set([...(before?.items ?? []), ...(before?.maybe ?? [])]);
    enemies.push({
      heroId: hero.id,
      threat: row.threat === "high" || row.threat === "low" ? row.threat : "medium",
      note: text(row.note, 160),
      // Items never leave an inventory mid-match, so what was already believed stays believed.
      items: [...new Set([...(before?.items ?? []), ...named.filter((id) => seenBefore.has(id))])].slice(0, 6),
      maybe: named.filter((id) => !seenBefore.has(id)),
    });
  }
  if (!enemies.length) return undefined;
  return { at: now, model, summary: text(r.summary, 180), enemies };
}

/** Canned answer for the demo reader. */
export function demoEnemies(s: Session): Record<string, unknown> {
  const top = [...s.enemies].sort((a, b) => (s.enemyLive[b]?.gold ?? 0) - (s.enemyLive[a]?.gold ?? 0))[0];
  return {
    summary: top ? `Respect ${heroName(top)}; the rest are even with you.` : "No one stands out yet.",
    enemies: s.enemies.map((id) => ({
      hero: heroName(id),
      threat: id === top && (s.enemyLive[id]?.kills ?? 0) >= 5 ? "high" : "medium",
      items: id === top ? ["Arcane Boots", "Not A Real Item"] : [],
      note: id === top ? "Bursts you from a dash. Stay behind your tank." : "Keep your distance and hit from range.",
    })),
  };
}
