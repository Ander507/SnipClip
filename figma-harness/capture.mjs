#!/usr/bin/env node
/**
 * Renders every SnipClip screen with a mocked Tauri backend and writes one self-contained
 * HTML file per screen to figma-harness/out/NN-name.html (for Figma's html_to_figma).
 *
 *   node figma-harness/capture.mjs            # all screens
 *   node figma-harness/capture.mjs viewer     # only screens whose file name contains "viewer"
 *   node figma-harness/capture.mjs --png      # also write a PNG of the live render next to each
 */
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serializePage } from "./serialize.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");
const args = process.argv.slice(2);
const wantPng = args.includes("--png");
const filter = args.find((a) => !a.startsWith("--"));

// ---- playwright: project/global install first, then the npx cache ----------------------
async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    /* fall through */
  }
  const candidates = [];
  const npxRoot = path.join(os.homedir(), "AppData", "Local", "npm-cache", "_npx");
  const npmCache = process.env.npm_config_cache ? path.join(process.env.npm_config_cache, "_npx") : null;
  for (const root of [npxRoot, npmCache, path.join(os.homedir(), ".npm", "_npx")]) {
    if (!root || !fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root)) {
      const pkg = path.join(root, d, "node_modules", "playwright");
      if (fs.existsSync(path.join(pkg, "package.json"))) candidates.push(pkg);
    }
  }
  const globalRoot = path.join(process.env.APPDATA ?? "", "npm", "node_modules", "playwright");
  if (fs.existsSync(globalRoot)) candidates.unshift(globalRoot);
  for (const pkg of candidates) {
    try {
      return createRequire(pathToFileURL(path.join(pkg, "package.json")))(pkg);
    } catch {
      /* try next */
    }
  }
  throw new Error("Playwright not found — run `npx playwright install chromium` or `npm i -D playwright`.");
}

const SIZES = {
  main: { width: 976, height: 669 },
  palette: { width: 600, height: 400 },
  popup: { width: 220, height: 140 },
  recorder: { width: 380, height: 52 },
  toast: { width: 300, height: 64 },
  editor: { width: 980, height: 720 },
  snip: { width: 1280, height: 720 },
};

const QUERY = {
  main: "",
  palette: "?view=palette",
  popup: "?view=popup",
  recorder: "?view=recorder",
  toast: "?view=replay-toast",
  editor: "?view=video-editor",
  snip: "?mode=snip",
};

const fsSafe = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const pw = await loadPlaywright();
fs.mkdirSync(outDir, { recursive: true });

const server = await createServer({ configFile: path.join(here, "vite.config.ts") });
await server.listen();
const base = (server.resolvedUrls?.local?.[0] ?? "http://localhost:1430/").replace(/\/$/, "");
console.log(`harness server: ${base}/figma-harness/index.html`);

const browser = await pw.chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--force-color-profile=srgb"],
});

let n = 0;
const written = [];
const skipped = [];
const problems = [];

async function open(win, scenario = {}) {
  const size = SIZES[win];
  const ctx = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    // Day names and times follow the browser locale (the real app follows Windows)
    locale: process.env.FX_LOCALE || "en-US",
  });
  await ctx.addInitScript((s) => {
    window.__SCENARIO__ = s;
  }, scenario);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const url = `${base}/figma-harness/index.html${QUERY[win]}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    errors.length = 0;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__fx && window.__fx.ready);
    await page.evaluate(() => window.__fx.ready);
    await page.waitForTimeout(900);
    // Vite may re-optimize deps on a cold cache and invalidate the lazy chunks once
    if (!errors.some((e) => /Outdated Optimize Dep|dynamically imported module/.test(e))) break;
  }
  page.__errors = errors;
  page.__win = win;
  return { ctx, page };
}

/** Wait until every <img> on the page has decoded and every <video> has a frame. */
async function settle(page, ms = 400) {
  await page
    .waitForFunction(
      () =>
        Array.from(document.images).every((i) => i.complete) &&
        Array.from(document.querySelectorAll("video")).every((v) => v.readyState >= 2 || v.error),
      null,
      { timeout: 6000 }
    )
    .catch(() => undefined);
  await page.waitForTimeout(ms);
}

async function capture(page, title, opts = {}) {
  const num = String(++n).padStart(2, "0");
  const file = `${num}-${fsSafe(title)}.html`;
  if (filter && !file.includes(filter)) return;
  const size = SIZES[page.__win];
  await settle(page, opts.settle ?? 400);
  if (opts.backgroundImage) {
    // Transparent overlay window: show the desktop it sits on (live PNG and HTML alike)
    await page.evaluate(async (u) => {
      const blob = await (await fetch(u)).blob();
      const data = await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(blob);
      });
      document.documentElement.style.setProperty("background", `url("${data}") center / cover no-repeat`, "important");
    }, opts.backgroundImage);
  }
  const png = wantPng ? path.join(outDir, file.replace(/\.html$/, ".live.png")) : null;
  if (png) await page.screenshot({ path: png });
  const html = await page.evaluate(serializePage, {
    name: title,
    width: size.width,
    height: size.height,
    background: opts.background ?? "auto",
    backgroundImage: opts.backgroundImage ?? null,
    keepHover: !!opts.keepHover,
  });
  fs.writeFileSync(path.join(outDir, file), html);
  const failed = await page.evaluate(() => (window.__fxFailed ?? []).splice(0));
  if (failed.length) problems.push(`${file}: images that failed to load ${[...new Set(failed)].join(", ")}`);
  const ext = html.match(/(?:src|href)=["'](?!data:|#)[^"']+["']|url\((?!(?:["']|&quot;)?(?:data:|#))[^)]{0,80}\)/g);
  if (ext) problems.push(`${file}: external refs ${ext.slice(0, 3).join(", ")}`);
  written.push(file);
  console.log(`  ${file}  (${(html.length / 1024).toFixed(0)} KB)`);
}

async function step(title, fn) {
  try {
    await fn();
  } catch (err) {
    skipped.push(`${title}: ${String(err.message ?? err).split("\n")[0]}`);
    console.warn(`  ! ${title}: ${String(err.message ?? err).split("\n")[0]}`);
  }
}

async function withWindow(win, scenario, fn) {
  const { ctx, page } = await open(win, scenario);
  try {
    await fn(page);
  } finally {
    const unknown = await page.evaluate(() => [...new Set(window.__fx.unknown)]).catch(() => []);
    if (unknown.length) problems.push(`${win}: unmocked commands ${unknown.join(", ")}`);
    const errs = page.__errors.filter((e) => !/Couldn't find callback id/.test(e));
    if (errs.length) problems.push(`${win}: console errors: ${errs.slice(0, 3).join(" | ").slice(0, 300)}`);
    await ctx.close();
  }
}

const tab = (page, label) =>
  page.locator("aside nav button").filter({ hasText: new RegExp(`^${label}`) }).first().click();

const neutralMouse = (page) => page.mouse.move(2, 668);

async function closeViewer(page) {
  await page.evaluate(() => document.querySelector("[data-media-viewer] video")?.pause());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  if (await page.locator("[data-media-viewer]").count()) {
    await page.locator("[data-media-viewer] [aria-label='Close'], [data-media-viewer] [title^='Close']").first().click();
    await page.waitForTimeout(400);
  }
}

// ======================================================================================
// Main window
// ======================================================================================
console.log("main window");
await withWindow("main", {}, async (page) => {
  await capture(page, "Main · All");
  for (const [label, title] of [
    ["Text", "Main · Text"],
    ["Images", "Main · Images (grid)"],
    ["Screenshots", "Main · Screenshots (grid)"],
    ["Clips", "Main · Clips (grid)"],
    ["Math", "Main · Math"],
    ["Links", "Main · Links"],
    ["Pinned", "Main · Pinned"],
  ]) {
    await step(title, async () => {
      await tab(page, label);
      await page.waitForTimeout(600);
      await neutralMouse(page);
      await capture(page, title, { settle: label === "Clips" ? 1200 : 500 });
    });
  }

  await step("row hover", async () => {
    await tab(page, "All");
    await page.waitForTimeout(500);
    const rows = page.locator("[role=option]");
    await rows.nth(2).click();
    await rows.nth(4).hover();
    await page.waitForTimeout(400);
    await capture(page, "Main · Row selected + hovered (actions)", { keepHover: true });
  });

  await step("search results", async () => {
    const search = page.getByPlaceholder("Search clips, text, links…");
    await search.click();
    await search.fill("figma");
    await page.waitForTimeout(700);
    await neutralMouse(page);
    await capture(page, "Main · Search with results");
    await search.fill("kubernetes");
    await page.waitForTimeout(700);
    await capture(page, "Main · Search no results");
    await search.fill("");
    await page.waitForTimeout(500);
  });

  await step("delete undo", async () => {
    await page.keyboard.press("Escape");
    await tab(page, "All");
    await page.waitForTimeout(500);
    const row = page.locator("[role=option]").nth(3);
    await row.hover();
    await page.waitForTimeout(200);
    await row.locator('[title="Delete"]').click();
    await page.waitForTimeout(350);
    await neutralMouse(page);
    await capture(page, "Main · Deleted with Undo toast");
  });
});

await step("empty library", () =>
  withWindow("main", { empty: true }, async (page) => {
    await capture(page, "Main · Empty library");
  })
);

await step("empty clips", () =>
  withWindow("main", { noVideos: true }, async (page) => {
    await tab(page, "Clips");
    await page.waitForTimeout(500);
    await capture(page, "Main · Clips empty");
  })
);

await step("paused", () =>
  withWindow("main", { paused: true }, async (page) => {
    await capture(page, "Main · Clipboard listening paused");
  })
);

await step("sidebar collapsed", () =>
  withWindow("main", { uiPrefs: { sidebarCollapsed: true } }, async (page) => {
    await capture(page, "Main · Sidebar collapsed");
  })
);

await step("light theme", () =>
  withWindow("main", { settings: { themeMode: "light" } }, async (page) => {
    await capture(page, "Main · All (light theme)");
  })
);

// ======================================================================================
// Media viewer
// ======================================================================================
console.log("media viewer");
await withWindow("main", {}, async (page) => {
  await step("viewer video", async () => {
    await tab(page, "Clips");
    await page.waitForTimeout(1200);
    await page.locator("[role=option]").first().dblclick();
    await page.waitForSelector("[data-media-viewer] video", { timeout: 5000 });
    // Headless Chromium leaves the autoplayed clip paused; start it the way autoplay would
    await page.evaluate(() => document.querySelector("[data-media-viewer] video")?.play());
    await page.waitForFunction(
      () => {
        const v = document.querySelector("[data-media-viewer] video");
        return v && !v.paused && v.currentTime > 1.2;
      },
      null,
      { timeout: 8000 }
    );
    await page.mouse.move(480, 300);
    await page.mouse.move(490, 320);
    await page.waitForTimeout(250);
    await capture(page, "Media Viewer · Video playing (controls visible)", { settle: 100 });
    await closeViewer(page);
  });

  await step("viewer missing video", async () => {
    const tiles = page.locator("[role=option]");
    await tiles.nth((await tiles.count()) - 1).dblclick();
    await page.waitForSelector("text=missing or can't be played", { timeout: 6000 });
    await page.mouse.move(480, 300);
    await capture(page, "Media Viewer · Missing video file");
    await closeViewer(page);
  });

  await step("viewer image", async () => {
    await tab(page, "Screenshots");
    await page.waitForTimeout(800);
    await page.locator("[role=option]").first().dblclick();
    await page.waitForSelector('[data-media-viewer] [title="Zoom in (+)"]', { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.locator('[data-media-viewer] [title="Zoom in (+)"]').click();
    await page.waitForTimeout(400);
    await page.mouse.move(480, 300);
    await page.mouse.move(470, 310);
    await capture(page, "Media Viewer · Image with zoom pill");
  });
});

// ======================================================================================
// Settings
// ======================================================================================
console.log("settings");
await withWindow("main", {}, async (page) => {
  await page.locator("aside").getByText("Settings", { exact: true }).click();
  await page.waitForTimeout(900);
  const sections = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-settings-section]")).map((s) => ({
      id: s.getAttribute("data-settings-section"),
      title: s.querySelector("h2, h3")?.textContent?.trim() || s.getAttribute("data-settings-section"),
    }))
  );
  let lastTop = -1;
  for (const sec of sections) {
    await step(`settings ${sec.id}`, async () => {
      await page.evaluate((id) => window.__fx.emit("open-settings", { section: id }), sec.id);
      await page.waitForTimeout(1100);
      const top = await page.evaluate((id) => {
        const el = document.querySelector(`#settings-${id}`);
        let p = el?.parentElement;
        while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement;
        return p ? Math.round(p.scrollTop) : 0;
      }, sec.id);
      if (top === lastTop) {
        skipped.push(`Settings · ${sec.title}: already fully visible in the previous capture (end of page)`);
        return;
      }
      lastTop = top;
      await neutralMouse(page);
      await capture(page, `Settings · ${sec.title}`);
    });
  }
});

// ======================================================================================
// Other windows
// ======================================================================================
console.log("other windows");
await step("palette", () =>
  withWindow("palette", {}, async (page) => {
    await page.mouse.move(599, 399);
    await capture(page, "Command palette · Clipboard");
    for (const [label, title] of [
      ["Emoji", "Command palette · Emoji"],
      ["GIFs", "Command palette · GIFs"],
      ["Kaomoji", "Command palette · Kaomoji"],
      ["Symbols", "Command palette · Symbols"],
    ]) {
      await step(title, async () => {
        await page.locator(`button[aria-pressed][aria-label="${label}"]`).click();
        await page.waitForTimeout(700);
        await page.mouse.move(599, 399);
        await capture(page, title, { settle: 600 });
      });
    }
  })
);

await step("screenshot popup", () =>
  withWindow("popup", {}, async (page) => {
    await page.evaluate(async () => {
      const blob = await (await fetch("/media/big.jpg")).blob();
      const thumbnailDataUrl = await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(blob);
      });
      await window.__fx.emit("screenshot-popup-show", { vaultId: 102, width: 1280, height: 720, thumbnailDataUrl });
    });
    await page.waitForTimeout(600);
    await capture(page, "Screenshot popup");
  })
);

await step("recorder bar", () =>
  withWindow("recorder", {}, async (page) => {
    await capture(page, "Recorder bar · Ready");
    await page.getByRole("button", { name: /Start/ }).click();
    await page.waitForTimeout(2300);
    await page.mouse.move(379, 51);
    await capture(page, "Recorder bar · Recording");
    await page.getByRole("button", { name: /Pause/ }).click();
    await page.waitForTimeout(500);
    await page.mouse.move(379, 51);
    await capture(page, "Recorder bar · Paused");
  })
);

await step("snip overlay", () =>
  withWindow("snip", {}, async (page) => {
    await capture(page, "Snip overlay · Idle", { backgroundImage: "/media/big.jpg" });
    await page.mouse.move(360, 180);
    await page.mouse.down();
    await page.mouse.move(600, 330, { steps: 6 });
    await page.mouse.move(880, 520, { steps: 6 });
    await page.waitForTimeout(300);
    await capture(page, "Snip overlay · Dragging a selection", { backgroundImage: "/media/big.jpg" });
    await page.mouse.up();
  })
);

await step("video editor", () =>
  withWindow("editor", {}, async (page) => {
    await page.waitForSelector("video", { timeout: 6000 });
    await page.waitForTimeout(1500);
    await page.mouse.move(979, 719);
    await capture(page, "Video editor", { settle: 800 });
  })
);

await step("replay toast", () =>
  withWindow("toast", {}, async (page) => {
    const show = (p) => page.evaluate((payload) => window.__fx.emit("replay-toast", payload), p);
    await show({ id: 1, state: "saving", title: "Saving clip…", detail: "" });
    await page.waitForTimeout(500);
    await capture(page, "Replay toast · Saving");
    await show({ id: 2, state: "saved", title: "Clip saved", detail: "SnipClip Replay 2026-11-24 18-41-40.mp4" });
    await page.waitForTimeout(500);
    await capture(page, "Replay toast · Saved");
    await show({
      id: 3,
      state: "error",
      title: "Couldn't save clip",
      detail: "Instant replay isn't running yet",
    });
    await page.waitForTimeout(500);
    await capture(page, "Replay toast · Error");
  })
);

await browser.close();
await server.close();

console.log(`\n${written.length} files in ${path.relative(process.cwd(), outDir) || outDir}`);
if (skipped.length) console.log(`skipped:\n  ${skipped.join("\n  ")}`);
if (problems.length) console.log(`problems:\n  ${problems.join("\n  ")}`);
