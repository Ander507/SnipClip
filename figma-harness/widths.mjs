// Renders the media grids at several window widths and reports column counts and tile widths.
// Usage: node figma-harness/widths.mjs        → PNGs in figma-harness/out/widths/
//        node figma-harness/widths.mjs --collapsed   (sidebar collapsed)
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out", "widths");
const WIDTHS = [720, 960, 1200, 1440, 1920];
const TABS = ["Clips", "Screenshots", "Images"];
const collapsed = process.argv.includes("--collapsed");

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    /* fall through to npx cache */
  }
  const root = path.join(os.homedir(), "AppData", "Local", "npm-cache", "_npx");
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const pkg = path.join(root, d, "node_modules", "playwright");
    if (fs.existsSync(path.join(pkg, "package.json")))
      return createRequire(pathToFileURL(path.join(pkg, "package.json")))(pkg);
  }
  throw new Error("Playwright not found");
}

const pw = loadPlaywright();
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ configFile: path.join(here, "vite.config.ts") });
await server.listen();
const base = (server.resolvedUrls?.local?.[0] ?? "http://localhost:1430/").replace(/\/$/, "");
const browser = await pw.chromium.launch();
const rows = [];
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 820 }, deviceScaleFactor: 1, colorScheme: "dark" });
  await ctx.addInitScript((c) => {
    window.__SCENARIO__ = c ? { uiPrefs: { sidebarCollapsed: true } } : {};
  }, collapsed);
  const page = await ctx.newPage();
  await page.goto(`${base}/figma-harness/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__fx && window.__fx.ready);
  await page.waitForTimeout(900);
  for (const t of TABS) {
    const btn = page.locator("aside nav button").filter({ hasText: new RegExp(`^${t}`) }).first();
    if (await btn.count()) await btn.click();
    else await page.locator(`aside nav button[title^="${t}"], aside nav button[aria-label^="${t}"]`).first().click();
    await page.waitForTimeout(700);
    // First row of tiles: tiles sharing the top offset of the first tile.
    const m = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll("main [data-tile], main [role='gridcell'], main .group.rounded-xl")]
        .filter((e) => e.getBoundingClientRect().width > 100);
      if (!tiles.length) return null;
      const top = tiles[0].getBoundingClientRect().top;
      const row = tiles.filter((e) => Math.abs(e.getBoundingClientRect().top - top) < 4);
      const main = document.querySelector("main")?.getBoundingClientRect().width ?? 0;
      return { cols: row.length, tileW: Math.round(row[0].getBoundingClientRect().width), main: Math.round(main) };
    });
    rows.push({ width: w, tab: t, ...m });
    await page.screenshot({ path: path.join(outDir, `${collapsed ? "c" : "e"}-${w}-${t.toLowerCase()}.png`) });
  }
  await ctx.close();
}
await browser.close();
await server.close();
console.table(rows);
