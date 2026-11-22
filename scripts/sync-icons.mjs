#!/usr/bin/env node
/**
 * Downloads a small picture for every item and component in the catalog from
 * the Mobile Legends Fandom wiki, into public/items/, and writes a manifest the
 * app uses to show them. Re-run after adding items:  npm run sync-icons
 *
 * Item art belongs to Moonton; this is for a personal coaching tool.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://mobile-legends.fandom.com/api.php";
const SIZE = 128;
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "../public/items");
const MANIFEST = path.resolve(here, "../src/data/generated/item-icons.json");

/** Wiki page titles that differ from the in-game name. */
const TITLE_OVERRIDES = {};

const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/** Read item + component names (and aliases) straight from the catalog source. */
async function catalogNames() {
  const src = await readFile(path.resolve(here, "../src/data/items.ts"), "utf8");
  const out = new Map(); // file slug -> candidate wiki titles
  for (const m of src.matchAll(/\{ id: "([a-z_]+)", name: "([^"]+)"[^\n]*/g)) {
    const aliases = [...(m[0].match(/aliases: \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((a) => a[1]);
    out.set(m[1], [m[2], ...aliases]);
  }
  for (const m of src.matchAll(/c\("([^"]+)", \d+/g)) out.set(`c-${norm(m[1])}`, [m[1]]);
  return out;
}

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  const res = await fetch(url, { headers: { "user-agent": "item-icon-sync/1.0" } });
  if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
  return res.json();
}

/** The wiki stores each item's picture as "File:<Item Name>.png". */
async function lookup(titles) {
  const found = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const data = await api({ action: "query", prop: "imageinfo", iiprop: "url", iiurlwidth: String(SIZE), titles: batch.map((t) => `File:${t}.png`).join("|") });
    const back = new Map();
    for (const n of data.query?.normalized ?? []) back.set(n.to, n.from);
    for (const page of data.query?.pages ?? []) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const asked = (back.get(page.title) ?? page.title).replace(/^File:/, "").replace(/\.png$/, "");
      found.set(asked, info.thumburl ?? info.url);
    }
  }
  return found;
}

async function main() {
  const names = await catalogNames();
  const allTitles = [...new Set([...names.values()].flat().map((t) => TITLE_OVERRIDES[t] ?? t))];
  const urls = await lookup(allTitles);
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = {};
  const missing = [];
  for (const [slug, titles] of names) {
    const url = titles.map((t) => urls.get(TITLE_OVERRIDES[t] ?? t)).find(Boolean);
    if (!url) {
      missing.push(`${slug} (${titles[0]})`);
      continue;
    }
    const res = await fetch(url, { headers: { "user-agent": "item-icon-sync/1.0" } });
    if (!res.ok) {
      missing.push(`${slug} (HTTP ${res.status})`);
      continue;
    }
    const type = res.headers.get("content-type") ?? "";
    const ext = type.includes("webp") ? "webp" : type.includes("jpeg") ? "jpg" : "png";
    await writeFile(path.join(OUT_DIR, `${slug}.${ext}`), Buffer.from(await res.arrayBuffer()));
    manifest[slug] = `${slug}.${ext}`;
  }
  await writeFile(MANIFEST, JSON.stringify(manifest, Object.keys(manifest).sort(), 1) + "\n");
  console.log(`Saved ${Object.keys(manifest).length} of ${names.size} pictures → public/items/`);
  if (missing.length) console.log(`No picture found for: ${missing.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
