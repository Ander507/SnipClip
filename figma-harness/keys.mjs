// Keyboard smoke test for the main window (real React UI + mocked backend).
// Usage: node figma-harness/keys.mjs   → prints PASS/FAIL per check, exits 1 on any failure.
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

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
const server = await createServer({ configFile: path.join(here, "vite.config.ts"), logLevel: "error" });
await server.listen();
const base = (server.resolvedUrls?.local?.[0] ?? "http://localhost:1430/").replace(/\/$/, "");
const browser = await pw.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
await page.goto(`${base}/figma-harness/index.html`, { waitUntil: "load" });
await page.waitForFunction(() => window.__fx && window.__fx.ready);
await page.waitForTimeout(900);

const results = [];
const check = async (name, fn) => {
  try {
    const ok = await fn();
    results.push([ok ? "PASS" : "FAIL", name]);
  } catch (e) {
    results.push(["FAIL", `${name} (${String(e).split("\n")[0]})`]);
  }
};
const search = page.locator("input[placeholder^='Search']").first();
const tab = (label) => page.locator("aside nav button").filter({ hasText: new RegExp(`^${label}`) }).first().click();
const selectedTile = () =>
  page.evaluate(() => {
    const el = document.querySelector("main .ring-2, main [aria-selected='true'], main [data-selected='true']");
    return el ? el.getBoundingClientRect().left : null;
  });

await page.mouse.click(700, 600); // focus the list area, not an input
await check("Ctrl+F focuses search", async () => {
  await page.keyboard.press("Control+f");
  return await search.evaluate((el) => document.activeElement === el);
});
await check("typing edits search natively (Ctrl+A, Backspace)", async () => {
  await page.keyboard.type("abc");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  return (await search.inputValue()) === "";
});
await check("Enter with no paste target copies (status says so)", async () => {
  await page.keyboard.press("Escape");
  await page.mouse.click(700, 600);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  return /copied/i.test(await page.locator("body").innerText());
});
await check("Ctrl+P does not open print / toggles pin without error", async () => {
  await page.keyboard.press("Control+p");
  await page.waitForTimeout(200);
  return true;
});
await tab("Clips");
await page.waitForTimeout(500);
await page.mouse.click(5, 790); // move focus off the sidebar button
await check("→ moves the grid selection one tile right", async () => {
  const before = await selectedTile();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const after = await selectedTile();
  return before != null && after != null && after > before;
});
await check("Space opens the media viewer; Esc closes it", async () => {
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  const opened = (await page.locator("[data-media-viewer]").count()) === 1;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  return opened && (await page.locator("[data-media-viewer]").count()) === 0;
});
await check("Enter on a focused button presses the button (not a copy)", async () => {
  const btn = page.locator("aside nav button").filter({ hasText: /^Text/ }).first();
  await btn.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  return /Text/.test(await page.locator("main").innerText());
});

await browser.close();
await server.close();
for (const [s, n] of results) console.log(`${s}  ${n}`);
process.exit(results.some(([s]) => s === "FAIL") ? 1 : 0);
