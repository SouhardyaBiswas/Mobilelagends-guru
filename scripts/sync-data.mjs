#!/usr/bin/env node
/**
 * Pulls hero + matchup data from Moonton's public stats API (the same one that
 * powers the hero pages on m.mobilelegends.com) and writes compact JSON the app
 * bundles. Re-run after every balance patch:  npm run sync-data
 *
 * No auth, no user data sent. Behind a corporate proxy run with
 *   NODE_USE_ENV_PROXY=1 npm run sync-data
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api.gms.moontontech.com/api/gms/source/2669606";
const SRC_HEROES = 2756564;
/** Matchup tables. Each id is a different trailing-day window of ranked games. */
const SRC_MATCHUPS = [2756567, 2756568, 2756569, 2756565, 2756570];
/** bigrank 101 = all ranks combined (largest sample, least noise). */
const BIGRANK_ALL = "101";
const PAGE = 200;
/** Cap on a single matchup delta, in win-rate points, to tame thin samples. */
const MAX_DELTA = 12;

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "../src/data/generated");

async function post(source, body, attempt = 1) {
  try {
    const res = await fetch(`${BASE}/${source}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lang": "en" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (String(json.code) !== "0") throw new Error(`API code ${json.code}: ${json.message}`);
    return json.data;
  } catch (err) {
    if (attempt >= 4) throw new Error(`source ${source} failed: ${err.message}`);
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    return post(source, body, attempt + 1);
  }
}

async function fetchAll(source, filters) {
  const out = [];
  for (let pageIndex = 1; ; pageIndex++) {
    const data = await post(source, { pageSize: PAGE, pageIndex, filters, sorts: [] });
    out.push(...data.records);
    if (out.length >= Number(data.total) || data.records.length === 0) return out;
  }
}

const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, "");
const count = (text, re) => (text.match(re) ?? []).length;
const clean = (arr) => (arr ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const LANE_ALIASES = {
  "Exp Lane": "exp",
  "Gold Lane": "gold",
  "Mid Lane": "mid",
  Roaming: "roam",
  Jungling: "jungle",
};

/** Text signals mined from skill descriptions; the app turns these into traits. */
function skillSignals(hero) {
  const skills = (hero.heroskilllist ?? []).flatMap((g) => g.skilllist ?? []);
  const text = skills.map((s) => stripTags(s.skilldesc)).join("\n");
  const tags = {};
  for (const s of skills) for (const t of s.skilltag ?? []) tags[t.tagname] = (tags[t.tagname] ?? 0) + 1;
  return {
    tags,
    sig: {
      phys: count(text, /Physical Damage/g),
      magic: count(text, /Magic Damage/g),
      trueDmg: count(text, /True Damage/g),
      heal: count(text, /restor\w* [^.]{0,40}HP|\bheals?\b|\bhealing\b|HP Regen|recovers? [^.]{0,30}HP/gi),
      vamp: count(text, /Spell Vamp|Lifesteal/gi),
      shield: count(text, /\bshield/gi),
      basic: count(text, /Basic Attack/g),
      atkSpeed: count(text, /Attack Speed/g),
      crit: count(text, /\bCrit/g),
      maxHp: count(text, /(target'?s?|enemy'?s?|their) (Max|lost|current) HP|% (of )?(the target's )?Max HP/gi),
      hardCc: count(
        text,
        /\bstun|knock(s|ed|ing)? (them |enemies |the target )?(back|up|airborne)|airborne|suppress|immobiliz|\bfreez|frozen|\btaunt|petrif|\bpull(s|ed|ing)?\b|transform(s|ed|ing)? (them|enemies|the target)|\bsilenc/gi,
      ),
      slow: count(text, /\bslow/gi),
      immune: count(text, /invincib|immune|immunity|untargetable|cannot be targeted/gi),
      conceal: count(text, /conceal|invisib|camouflage|stealth/gi),
      dash: count(text, /\bdash|\bblink|\bleap|\bcharges? (forward|toward|in)|teleport/gi),
    },
  };
}

/** Compact skill list: enough to name what to watch for and quote what it does. */
function skillList(hero) {
  const skills = (hero.heroskilllist ?? []).flatMap((g) => g.skilllist ?? []);
  return skills
    .map((sk, i) => {
      const text = stripTags(sk.skilldesc).replace(/\s+/g, " ").trim();
      // First sentence only, as Moonton wrote it; long sentences are cut at a word boundary.
      let first = text.split(/(?<=[.!?])\s/)[0] ?? "";
      if (first.length > 190) first = `${first.slice(0, 187).replace(/\s+\S*$/, "")}…`;
      const cd = /CD:\s*([\d.]+)/.exec(sk["skillcd&cost"] ?? "");
      const passive = !(sk["skillcd&cost"] ?? "").trim();
      return {
        name: String(sk.skillname ?? "").trim(),
        slot: passive && i === 0 ? "Passive" : i === skills.length - 1 ? "Ultimate" : `Skill ${i}`,
        cd: cd ? Number(cd[1]) : undefined,
        tags: [...new Set((sk.skilltag ?? []).map((t) => t.tagname))],
        text: first,
      };
    })
    .filter((sk) => sk.name);
}

function relation(rel) {
  const pick = (r) =>
    r && clean([r.desc]).length
      ? { ids: (r.target_hero_id ?? []).map(Number).filter((n) => n > 0), desc: stripTags(r.desc).replace(/\s+/g, " ").trim() }
      : undefined;
  return { strong: pick(rel?.strong), weak: pick(rel?.weak), assist: pick(rel?.assist) };
}

async function main() {
  console.log("Fetching heroes…");
  const heroRecords = await fetchAll(SRC_HEROES, []);
  const skills = {};
  for (const r of heroRecords) skills[Number(r.data.hero_id)] = skillList(r.data.hero.data);
  const heroes = heroRecords
    .map((r) => {
      const h = r.data.hero.data;
      const [durability, offense, effects, difficulty] = (h.abilityshow ?? []).map(Number);
      return {
        id: Number(r.data.hero_id),
        name: String(h.name).trim(),
        roles: clean(h.sortlabel),
        lanes: clean(h.roadsortlabel).map((l) => LANE_ALIASES[l] ?? l.toLowerCase()),
        specialities: clean(h.speciality),
        ability: { durability, offense, effects, difficulty },
        icon: h.head || r.data.head || "",
        ...skillSignals(h),
        relation: relation(r.data.relation),
      };
    })
    .sort((a, b) => a.id - b.id);
  const known = new Set(heroes.map((h) => h.id));
  console.log(`  ${heroes.length} heroes`);

  // pair key "main>sub" -> running sum / n of main's win-rate delta
  const versus = new Map();
  const withAlly = new Map();
  const stats = new Map();
  const add = (map, key, v) => {
    const cur = map.get(key) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    map.set(key, cur);
  };

  for (const source of SRC_MATCHUPS) {
    console.log(`Fetching matchup window ${source}…`);
    const records = await fetchAll(source, [{ field: "bigrank", operator: "eq", value: BIGRANK_ALL }]);
    for (const { data } of records) {
      const main = Number(data.main_heroid);
      if (!known.has(main)) continue;
      const target = String(data.match_type) === "0" ? versus : withAlly;
      const seen = new Set();
      for (const sub of [...(data.sub_hero ?? []), ...(data.sub_hero_last ?? [])]) {
        const other = Number(sub.heroid);
        if (!known.has(other) || other === main || seen.has(other)) continue;
        seen.add(other);
        add(target, `${main}>${other}`, Number(sub.increase_win_rate) * 100);
      }
      if (String(data.match_type) === "0") {
        const s = stats.get(main) ?? { win: 0, pick: 0, ban: 0, n: 0 };
        s.win += Number(data.main_hero_win_rate);
        s.pick += Number(data.main_hero_appearance_rate);
        s.ban += Number(data.main_hero_ban_rate);
        s.n += 1;
        stats.set(main, s);
      }
    }
  }

  const clamp = (v) => Math.max(-MAX_DELTA, Math.min(MAX_DELTA, v));
  /** vs[a][b] = how many win-rate points hero a gains when the enemy team has hero b. */
  const vs = {};
  const set = (a, b, v, direct) => {
    vs[a] ??= {};
    const cur = vs[a][b];
    // A direct observation beats one inferred from the opponent's record.
    if (!cur || (direct && !cur.direct)) vs[a][b] = { v, direct };
    else if (direct === cur.direct) vs[a][b] = { v: (cur.v + v) / 2, direct };
  };
  for (const [key, { sum, n }] of versus) {
    const [a, b] = key.split(">").map(Number);
    const v = clamp(sum / n);
    set(a, b, v, true);
    set(b, a, -v, false);
  }
  const versusOut = {};
  for (const [a, row] of Object.entries(vs)) {
    versusOut[a] = Object.fromEntries(Object.entries(row).map(([b, { v }]) => [b, round(v)]));
  }

  const allyOut = {};
  for (const [key, { sum, n }] of withAlly) {
    const [a, b] = key.split(">").map(Number);
    const v = round(clamp(sum / n));
    (allyOut[a] ??= {})[b] = v;
    // Synergy is symmetric; fill the mirror if we never saw it directly.
    if (allyOut[b]?.[a] === undefined) (allyOut[b] ??= {})[a] = v;
  }

  for (const h of heroes) {
    const s = stats.get(h.id);
    h.meta = s
      ? { win: round((s.win / s.n) * 100), pick: round((s.pick / s.n) * 100), ban: round((s.ban / s.n) * 100) }
      : { win: 50, pick: 0, ban: 0 };
  }

  const pairCount = Object.values(versusOut).reduce((n, row) => n + Object.keys(row).length, 0);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "heroes.json"), JSON.stringify(heroes));
  await writeFile(path.join(OUT_DIR, "matchups.json"), JSON.stringify({ versus: versusOut, ally: allyOut }));
  await writeFile(path.join(OUT_DIR, "skills.json"), JSON.stringify(skills));
  await writeFile(
    path.join(OUT_DIR, "meta.json"),
    JSON.stringify(
      {
        syncedAt: new Date().toISOString(),
        source: "Moonton public stats API (api.gms.moontontech.com), all ranks",
        heroes: heroes.length,
        versusPairs: pairCount,
        newestHero: heroes.at(-1)?.name,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote ${heroes.length} heroes, ${pairCount} matchup pairs → ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
