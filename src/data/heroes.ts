import rawHeroes from "./generated/heroes.json";
import rawMatchups from "./generated/matchups.json";
import type { Archetype, DamageType, Hero, HeroTraits, Lane, Role } from "../types";

interface RawHero {
  id: number;
  name: string;
  roles: string[];
  lanes: string[];
  specialities: string[];
  ability: { durability: number; offense: number; effects: number; difficulty: number };
  icon: string;
  tags: Record<string, number>;
  sig: Record<string, number>;
  relation: Hero["relation"];
  meta: { win: number; pick: number; ban: number };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Hand corrections where the kit text under- or mis-states something that matters
 * for item choices. Keep this short: the sync script covers everyone else.
 */
const OVERRIDES: Record<string, { damage?: DamageType; sustain?: number; archetype?: Archetype }> = {
  Melissa: { damage: "physical" },
  // Marksmen who burst with skills rather than sustained basic attacks.
  Granger: { archetype: "mm_burst" },
  Clint: { archetype: "mm_burst" },
  Lesley: { archetype: "mm_burst" },
  Brody: { archetype: "mm_burst" },
  Beatrix: { archetype: "mm_burst" },
  // Attack-speed marksmen who finish with crit rather than the on-hit trio.
  Miya: { archetype: "mm_crit" },
  Hanabi: { archetype: "mm_crit" },
  Moskov: { archetype: "mm_crit" },
  Irithel: { archetype: "mm_crit" },
  Obsidia: { archetype: "mm_crit" },
  Alucard: { sustain: 0.9 },
  Thamuz: { sustain: 0.7 },
  Dyrroth: { sustain: 0.6 },
  Fredrinn: { sustain: 0.6 },
  Alpha: { sustain: 0.7 },
  Masha: { sustain: 0.6 },
  Angela: { sustain: 0.6 },
  Carmilla: { sustain: 0.6 },
  Minotaur: { sustain: 0.6 },
  Faramis: { sustain: 0.5 },
  Leomord: { sustain: 0.5 },
};

function damageType(h: RawHero): DamageType {
  const phys = h.sig.phys ?? 0;
  const magic = h.sig.magic ?? 0;
  if (h.specialities.includes("Mixed Damage")) return "mixed";
  if (magic > phys * 1.5) return "magic";
  if (phys > magic * 1.5) return "physical";
  // Ambiguous kit text: fall back to what the role normally deals.
  if (h.specialities.includes("Magic Damage") || h.roles[0] === "Mage") return "magic";
  if (h.roles[0] === "Marksman" || h.roles[0] === "Assassin" || h.roles[0] === "Fighter") return "physical";
  return phys || magic ? "mixed" : "magic";
}

function traits(h: RawHero): HeroTraits {
  const has = (s: string) => h.specialities.includes(s);
  const tag = (t: string) => h.tags[t] ?? 0;
  const sig = (k: string) => h.sig[k] ?? 0;
  const role = (r: Role) => h.roles.includes(r);
  return {
    sustain: clamp01((has("Regen") ? 0.6 : 0) + tag("Heal") * 0.2 + sig("heal") * 0.08 + sig("vamp") * 0.1),
    shields: clamp01(tag("Shield") * 0.3 + sig("shield") * 0.06),
    burst: clamp01((has("Burst") ? 0.55 : 0) + (has("Finisher") ? 0.2 : 0) + tag("Burst") * 0.1 + (role("Assassin") ? 0.2 : 0)),
    basicAttacker: clamp01((h.roles[0] === "Marksman" ? 0.7 : 0) + sig("basic") * 0.07 + sig("atkSpeed") * 0.12),
    crit: sig("crit") > 0,
    cc: clamp01(tag("CC") * 0.28 + (has("Crowd Control") || has("Control") || has("Initiator") ? 0.3 : 0)),
    mobility: clamp01(tag("Mobility") * 0.3 + (has("Chase") || has("Charge") ? 0.3 : 0)),
    tanky: clamp01(h.ability.durability / 100 + (h.roles[0] === "Tank" ? 0.2 : 0)),
    trueDamage: sig("trueDmg") > 0,
    maxHpDamage: sig("maxHp") > 0,
    conceal: tag("Conceal") > 0 || sig("conceal") >= 2,
    poke: has("Poke"),
  };
}

function archetype(h: RawHero, dmg: DamageType, t: HeroTraits): Archetype {
  const [primary, secondary] = h.roles;
  switch (primary) {
    case "Marksman":
      if (dmg === "magic") return "mm_magic";
      return t.crit ? "mm_crit" : "mm_onhit";
    case "Mage":
      return "mage";
    case "Assassin":
      return dmg === "magic" ? "assassin_magic" : "assassin_phys";
    case "Fighter":
      return dmg === "magic" ? "fighter_magic" : "fighter_phys";
    case "Tank":
      // Tank/Mage hybrids (Esmeralda, Alice-style) build like sustain mages.
      return secondary === "Mage" ? "mage_tank" : "tank";
    case "Support":
      return t.sustain >= 0.6 ? "support_heal" : "support";
    default:
      return "fighter_phys";
  }
}

export const HEROES: Hero[] = (rawHeroes as unknown as RawHero[]).map((h) => {
  const fix = OVERRIDES[h.name];
  const damage = fix?.damage ?? damageType(h);
  const t = traits(h);
  if (fix?.sustain !== undefined) t.sustain = Math.max(t.sustain, fix.sustain);
  return {
    id: h.id,
    name: h.name,
    roles: h.roles as Role[],
    lanes: h.lanes as Lane[],
    specialities: h.specialities,
    icon: h.icon,
    ability: h.ability,
    meta: h.meta,
    damage,
    traits: t,
    archetype: fix?.archetype ?? archetype(h, damage, t),
    relation: h.relation ?? {},
  };
});

export const HEROES_BY_NAME: Hero[] = [...HEROES].sort((a, b) => a.name.localeCompare(b.name));

const byId = new Map(HEROES.map((h) => [h.id, h]));
export const heroById = (id: number): Hero | undefined => byId.get(id);
export const heroName = (id: number): string => byId.get(id)?.name ?? `Hero ${id}`;

const matchups = rawMatchups as unknown as {
  versus: Record<string, Record<string, number>>;
  ally: Record<string, Record<string, number>>;
};

/** Win-rate points `a` gains when the enemy team includes `b` (0 when no data). */
export const versus = (a: number, b: number): number | undefined => matchups.versus[a]?.[b];
/** Win-rate points `a` gains when teamed with `b`. */
export const synergy = (a: number, b: number): number | undefined => matchups.ally[a]?.[b];

export const normalizeName = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

const NAME_ALIASES: Record<string, string> = {
  popol: "Popol and Kupa",
  popolkupa: "Popol and Kupa",
  popolandkupa: "Popol and Kupa",
  yss: "Yi Sun-shin",
  yisunshin: "Yi Sun-shin",
  xborg: "X.Borg",
  change: "Chang'e",
  luoyi: "Luo Yi",
  yuzhong: "Yu Zhong",
  lapulapu: "Lapu-Lapu",
};

const byNormName = new Map(HEROES.map((h) => [normalizeName(h.name), h]));

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length]!;
}

/** Resolve a hero from free text (vision output, typing). Tolerates small typos. */
export function findHero(text: string): Hero | undefined {
  const key = normalizeName(text);
  if (!key) return undefined;
  const alias = NAME_ALIASES[key];
  if (alias) return byNormName.get(normalizeName(alias));
  const exact = byNormName.get(key);
  if (exact) return exact;
  let best: Hero | undefined;
  let bestDist = Infinity;
  for (const [norm, hero] of byNormName) {
    const d = editDistance(key, norm);
    if (d < bestDist) {
      bestDist = d;
      best = hero;
    }
  }
  // Allow one typo per ~5 characters; short names must match exactly.
  return bestDist <= Math.floor(key.length / 5) ? best : undefined;
}
