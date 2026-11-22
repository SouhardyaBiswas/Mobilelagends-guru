import { findHero } from "../data/heroes";
import { findItem } from "../data/items";
import type { Observation, PlayerState, ScreenKind, ShopEntry } from "../types";

/**
 * JSON Schema for the model's answer. Kept to the subset both Claude structured
 * outputs and Gemini accept: every field required, no nullables (unknown is ""
 * or -1), no numeric bounds.
 */
const PLAYER_SCHEMA = {
  type: "object",
  properties: {
    hero: { type: "string", description: "Hero name from the provided list, or empty string if unsure." },
    isMe: { type: "boolean", description: "True only for the highlighted row that belongs to the user." },
    kills: { type: "integer", description: "-1 if not visible." },
    deaths: { type: "integer", description: "-1 if not visible." },
    assists: { type: "integer", description: "-1 if not visible." },
    gold: { type: "integer", description: "Total gold shown for this player, -1 if not visible." },
    level: { type: "integer", description: "-1 if not visible." },
    items: {
      type: "array",
      items: { type: "string" },
      description: "Item names from the provided list, in slot order. Omit icons you cannot identify.",
    },
  },
  required: ["hero", "isMe", "kills", "deaths", "assists", "gold", "level", "items"],
  additionalProperties: false,
} as const;

const SHOP_ITEM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Item name exactly as printed." },
    price: { type: "integer", description: "Price printed on the item, -1 if not visible." },
  },
  required: ["name", "price"],
  additionalProperties: false,
} as const;

export const VISION_SCHEMA = {
  type: "object",
  properties: {
    screen: {
      type: "string",
      enum: ["draft", "loading", "scoreboard", "shop", "gameplay", "post_game", "other"],
    },
    gameTime: { type: "string", description: "Match clock as mm:ss if visible, else empty string." },
    myGold: { type: "integer", description: "The user's current spendable gold if visible, else -1." },
    allies: { type: "array", items: PLAYER_SCHEMA, description: "The user's team, including the user." },
    enemies: { type: "array", items: PLAYER_SCHEMA },
    myItems: {
      type: "array",
      items: { type: "string" },
      description: "Items the player owns: the shop's bottom inventory row, or the player's own scoreboard row. Empty if not visible.",
    },
    recommended: { type: "array", items: SHOP_ITEM_SCHEMA, description: "Shop only: items listed before the Spare Equipment heading." },
    spare: { type: "array", items: SHOP_ITEM_SCHEMA, description: "Shop only: items listed under Spare Equipment." },
    tip: {
      type: "string",
      description: "One coaching sentence (max 18 words) grounded in what is visible, or empty string.",
    },
  },
  required: ["screen", "gameTime", "myGold", "allies", "enemies", "myItems", "recommended", "spare", "tip"],
  additionalProperties: false,
} as const;

interface RawPlayer {
  hero?: unknown;
  isMe?: unknown;
  kills?: unknown;
  deaths?: unknown;
  assists?: unknown;
  gold?: unknown;
  level?: unknown;
  items?: unknown;
}

const SCREENS: readonly ScreenKind[] = ["draft", "loading", "scoreboard", "shop", "gameplay", "post_game", "other"];

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};

export function parseGameTime(text: unknown): number | undefined {
  if (typeof text !== "string") return undefined;
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(text);
  if (!m) return undefined;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return sec <= 60 * 60 ? sec : undefined;
}

/** Pull the first JSON object out of a model reply (tolerates code fences / prose). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Vision model returned no JSON");
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Turn the model's raw JSON into trusted app state: hero and item names are
 * matched against our catalog, anything unrecognised is dropped (and reported)
 * rather than guessed.
 */
export function normalizeObservation(raw: unknown): Observation {
  const r = (raw ?? {}) as Record<string, unknown>;
  const unknown: string[] = [];

  const players = (list: unknown): { rows: PlayerState[]; me?: number } => {
    if (!Array.isArray(list)) return { rows: [] };
    const rows: PlayerState[] = [];
    const seen = new Set<number>();
    let me: number | undefined;
    for (const entry of list.slice(0, 5) as RawPlayer[]) {
      const name = typeof entry?.hero === "string" ? entry.hero.trim() : "";
      if (!name) continue;
      const hero = findHero(name);
      if (!hero) {
        unknown.push(name);
        continue;
      }
      if (seen.has(hero.id)) continue;
      seen.add(hero.id);
      const items: string[] = [];
      for (const itemName of Array.isArray(entry.items) ? entry.items.slice(0, 6) : []) {
        if (typeof itemName !== "string" || !itemName.trim()) continue;
        const item = findItem(itemName);
        if (item) items.push(item.id);
        else unknown.push(itemName.trim());
      }
      if (entry.isMe === true && me === undefined) me = hero.id;
      rows.push({
        heroId: hero.id,
        kills: num(entry.kills),
        deaths: num(entry.deaths),
        assists: num(entry.assists),
        gold: num(entry.gold),
        level: num(entry.level),
        items,
      });
    }
    return { rows, me };
  };

  let mine = players(r.allies);
  let theirs = players(r.enemies);
  // The highlighted row is the user's by definition. If the model filed it under
  // "enemies", it has the two teams the wrong way round — flip them.
  if (mine.me === undefined && theirs.me !== undefined) [mine, theirs] = [theirs, mine];
  const meHeroId = mine.me;
  const allies = mine.rows;
  const enemies = theirs.rows.filter((e) => !allies.some((a) => a.heroId === e.heroId));
  const itemIds = (list: unknown): string[] => {
    const out: string[] = [];
    for (const name of Array.isArray(list) ? list.slice(0, 6) : []) {
      if (typeof name !== "string" || !name.trim()) continue;
      const item = findItem(name);
      if (item) out.push(item.id);
      else unknown.push(name.trim());
    }
    return out;
  };
  const shopEntries = (list: unknown): ShopEntry[] => {
    const out: ShopEntry[] = [];
    for (const entry of Array.isArray(list) ? (list.slice(0, 12) as Array<{ name?: unknown; price?: unknown }>) : []) {
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      if (!name) continue;
      const item = findItem(name);
      // Only finished items belong in a build list.
      if (item && !item.id.startsWith("comp:")) out.push({ id: item.id, price: num(entry.price) });
      else if (!item) unknown.push(name);
    }
    return out;
  };
  const recommended = shopEntries(r.recommended);
  const spare = shopEntries(r.spare);
  const myItems = itemIds(r.myItems);

  const screen = SCREENS.includes(r.screen as ScreenKind) ? (r.screen as ScreenKind) : "other";
  const tip = typeof r.tip === "string" ? r.tip.trim().slice(0, 200) : "";

  return {
    screen,
    gameTimeSec: parseGameTime(r.gameTime),
    myGold: num(r.myGold),
    allies,
    enemies,
    meHeroId,
    myItems: myItems.length ? myItems : undefined,
    shop: recommended.length || spare.length ? { recommended, spare } : undefined,
    tip: tip || undefined,
    unknown: [...new Set(unknown)],
  };
}
