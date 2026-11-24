#!/usr/bin/env node
/**
 * Opens each out/*.html offline (file://, all network blocked), screenshots it to
 * out/NN-name.static.png and, when capture.mjs ran with --png, compares it with the live render
 * (out/NN-name.live.png): prints the share of pixels that differ noticeably.
 *
 *   node figma-harness/verify.mjs            # all files
 *   node figma-harness/verify.mjs 01 26      # files whose name contains any of the args
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");
const filters = process.argv.slice(2);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    /* npx cache */
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
const browser = await pw.chromium.launch();
const files = fs
  .readdirSync(outDir)
  .filter((f) => f.endsWith(".html"))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
  .sort();

for (const file of files) {
  const html = fs.readFileSync(path.join(outDir, file), "utf8");
  const [, w, h] = html.match(/\.board \{ position:relative; width:(\d+)px; height:(\d+)px/) ?? [];
  const width = Number(w) || 976;
  const height = Number(h) || 669;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const blocked = [];
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file:") || url.startsWith("data:")) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(outDir, file)).href);
  await page.waitForTimeout(250);
  const staticPng = path.join(outDir, file.replace(/\.html$/, ".static.png"));
  await page.screenshot({ path: staticPng });
  const livePng = path.join(outDir, file.replace(/\.html$/, ".live.png"));
  let diff = "";
  if (fs.existsSync(livePng)) {
    const a = `data:image/png;base64,${fs.readFileSync(livePng).toString("base64")}`;
    const b = `data:image/png;base64,${fs.readFileSync(staticPng).toString("base64")}`;
    const share = await page.evaluate(
      async ([a, b]) => {
        const load = (src) =>
          new Promise((res) => {
            const i = new Image();
            i.onload = () => res(i);
            i.src = src;
          });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const px = (img) => {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext("2d");
          g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, c.width, c.height).data;
        };
        const da = px(ia);
        const db = px(ib);
        if (da.length !== db.length) return -1;
        let bad = 0;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
          if (d > 48) bad++;
        }
        return bad / (da.length / 4);
      },
      [a, b]
    );
    diff = share < 0 ? "size mismatch" : `${(share * 100).toFixed(2)}% px differ`;
  }
  console.log(`${file.padEnd(58)} ${diff}${blocked.length ? `  BLOCKED ${blocked.length}: ${blocked[0]}` : ""}`);
  await ctx.close();
}
await browser.close();
