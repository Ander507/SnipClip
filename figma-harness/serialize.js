/**
 * Runs inside the page (page.evaluate). Turns the live React render into one static,
 * self-contained HTML document for Figma's html_to_figma:
 *  - <video> / <canvas> become <img> of their current frame, every <img> becomes a data: URI
 *  - all CSS is collected into one <style>; :hover / :focus states that are live right now are
 *    kept by rewriting them to classes on the elements that match
 *  - scrolled containers are frozen by translating their children (no JS in the output)
 *  - form values become attributes, scripts are removed, the visible screen is wrapped in
 *    <div class="board" data-name="…"> sized to the window
 *
 * @param {{ name: string, width: number, height: number, background?: string, keepHover?: boolean }} opts
 */
export async function serializePage(opts) {
  const { name, width, height, keepHover = false } = opts;

  const blobToDataURL = (blob) =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });

  const urlCache = new Map();
  async function fetchDataURL(url) {
    if (!url || url.startsWith("data:")) return url;
    if (urlCache.has(url)) return urlCache.get(url);
    const p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const blob = await res.blob();
      if (blob.type === "image/gif") {
        // Animated GIF: keep the frame that is on screen now as a still
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        return c.toDataURL("image/png");
      }
      return blobToDataURL(blob);
    })();
    urlCache.set(url, p);
    return p;
  }

  let seq = 0;
  const nextId = () => `fx${++seq}`;
  const repl = new Map();

  // ---- media → data URIs (async, on the live DOM) ---------------------------------------
  for (const v of document.querySelectorAll("video")) {
    const id = nextId();
    v.setAttribute("data-fx-id", id);
    let data = null;
    try {
      if (v.readyState >= 2 && v.videoWidth > 0) {
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext("2d").drawImage(v, 0, 0);
        data = c.toDataURL("image/jpeg", 0.88);
      } else if (v.poster) {
        data = await fetchDataURL(v.poster);
      }
    } catch {
      data = null;
    }
    const cs = getComputedStyle(v);
    repl.set(id, {
      kind: "video",
      data,
      objectFit: cs.objectFit,
      objectPosition: cs.objectPosition,
    });
  }

  for (const c of document.querySelectorAll("canvas")) {
    const id = nextId();
    c.setAttribute("data-fx-id", id);
    let data = null;
    try {
      data = c.width > 0 && c.height > 0 ? c.toDataURL("image/png") : null;
    } catch {
      data = null;
    }
    repl.set(id, { kind: "canvas", data, w: c.offsetWidth, h: c.offsetHeight });
  }

  for (const img of document.querySelectorAll("img")) {
    const src = img.currentSrc || img.getAttribute("src") || "";
    const id = nextId();
    img.setAttribute("data-fx-id", id);
    let data = src;
    if (src && !src.startsWith("data:")) {
      try {
        data = await fetchDataURL(src);
      } catch {
        data = null;
        (window.__fxFailed ??= []).push(src);
      }
    }
    repl.set(id, { kind: "img", data });
  }

  // Inline-style background images (theme wallpaper, etc.)
  for (const el of document.querySelectorAll("[style*='url(']")) {
    const style = el.getAttribute("style") || "";
    for (const m of style.matchAll(/url\((['"]?)(?!data:)([^'")]+)\1\)/g)) {
      try {
        await fetchDataURL(m[2]);
      } catch {
        /* left as is */
      }
    }
  }

  // ---- CSS -------------------------------------------------------------------------------
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    const node = sheet.ownerNode;
    if (node && node.tagName === "STYLE") {
      css += node.textContent + "\n";
    } else {
      try {
        css += Array.from(sheet.cssRules, (r) => r.cssText).join("\n") + "\n";
      } catch {
        /* cross-origin sheet: none expected */
      }
    }
  }
  // url(...) inside CSS → data URIs
  const cssUrls = [...css.matchAll(/url\((['"]?)(?!data:|#)([^'")]+)\1\)/g)].map((m) => m[2]);
  for (const u of new Set(cssUrls)) {
    try {
      const data = await fetchDataURL(new URL(u, location.href).href);
      css = css.split(u).join(data);
    } catch {
      /* unresolved url stays; reported by the capture check */
    }
  }
  // Keep the interaction state that is live right now as plain classes
  css = css
    .replace(/@media\s*\(hover:\s*hover\)/g, "@media all")
    .replace(/:hover\b/g, ".fx-hover")
    .replace(/:focus-visible\b/g, ".fx-focus-visible")
    .replace(/:focus-within\b/g, ".fx-focus-within")
    .replace(/:focus(?![-\w])/g, ".fx-focus");

  // ---- synchronous freeze (layout reads + clone in one task) -----------------------------
  const marks = [];
  const mark = (el, attr, value = "") => {
    el.setAttribute(attr, value);
    marks.push([el, attr]);
  };

  if (keepHover) for (const el of document.querySelectorAll(":hover")) mark(el, "data-fx-hover");
  for (const el of document.querySelectorAll(":focus")) mark(el, "data-fx-focus");
  for (const el of document.querySelectorAll(":focus-visible")) mark(el, "data-fx-focus-visible");
  for (const el of document.querySelectorAll(":focus-within")) mark(el, "data-fx-focus-within");

  // Form state lives in properties; copy it to attributes so it survives outerHTML
  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (el.tagName === "TEXTAREA") {
      mark(el, "data-fx-value", el.value);
    } else if (el.tagName === "SELECT") {
      mark(el, "data-fx-select", String(el.selectedIndex));
    } else if (el.type === "checkbox" || el.type === "radio") {
      mark(el, "data-fx-checked", el.checked ? "1" : "0");
    } else {
      mark(el, "data-fx-value", el.value);
    }
  }

  // Scroll positions: translate children so the static page shows the scrolled view
  const scrollers = Array.from(document.querySelectorAll("*")).filter(
    (el) => el.scrollTop > 0 || el.scrollLeft > 0
  );
  for (const el of scrollers) {
    const kids = Array.from(el.children).filter((k) => getComputedStyle(k).position !== "fixed");
    const stickies = Array.from(el.querySelectorAll("*")).filter(
      (k) => k.parentElement !== el && getComputedStyle(k).position === "sticky"
    );
    const before = kids.map((k) => k.getBoundingClientRect());
    const sBefore = stickies.map((k) => k.getBoundingClientRect());
    const top = el.scrollTop;
    const left = el.scrollLeft;
    el.scrollTop = 0;
    el.scrollLeft = 0;
    const after = kids.map((k) => k.getBoundingClientRect());
    const sAfter = stickies.map((k) => k.getBoundingClientRect());
    el.scrollTop = top;
    el.scrollLeft = left;
    mark(el, "data-fx-scroller");
    kids.forEach((k, i) => {
      const dx = before[i].left - after[i].left;
      const dy = before[i].top - after[i].top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      const t = getComputedStyle(k).transform;
      mark(k, "data-fx-shift", JSON.stringify({ dx, dy, t: t === "none" ? "" : t }));
    });
    stickies.forEach((k, i) => {
      const kid = kids.find((c) => c.contains(k));
      const idx = kid ? kids.indexOf(kid) : -1;
      const pdx = idx >= 0 ? before[idx].left - after[idx].left : 0;
      const pdy = idx >= 0 ? before[idx].top - after[idx].top : 0;
      const dx = sBefore[i].left - (sAfter[i].left + pdx);
      const dy = sBefore[i].top - (sAfter[i].top + pdy);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      const t = getComputedStyle(k).transform;
      mark(k, "data-fx-shift", JSON.stringify({ dx, dy, t: t === "none" ? "" : t, sticky: 1 }));
    });
  }

  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const htmlClone = document.documentElement.cloneNode(true);
  for (const [el, attr] of marks) el.removeAttribute(attr);
  for (const el of document.querySelectorAll("[data-fx-id]")) el.removeAttribute("data-fx-id");

  // ---- rewrite the clone -----------------------------------------------------------------
  const q = (sel) => Array.from(htmlClone.querySelectorAll(sel));
  const appendStyle = (el, text) => {
    const cur = el.getAttribute("style") || "";
    el.setAttribute("style", cur && !cur.trim().endsWith(";") ? `${cur};${text}` : cur + text);
  };

  for (const el of q("[data-fx-id]")) {
    const id = el.getAttribute("data-fx-id");
    el.removeAttribute("data-fx-id");
    const r = repl.get(id);
    if (!r) continue;
    if (r.kind === "img") {
      if (r.data) el.setAttribute("src", r.data);
      else el.removeAttribute("src");
      el.removeAttribute("srcset");
      el.removeAttribute("crossorigin");
      el.removeAttribute("loading");
      continue;
    }
    const doc = el.ownerDocument;
    const img = doc.createElement(r.data ? "img" : "div");
    for (const a of Array.from(el.attributes)) {
      if (["src", "poster", "autoplay", "controls", "muted", "loop", "playsinline", "preload", "crossorigin"].includes(a.name)) continue;
      img.setAttribute(a.name, a.value);
    }
    if (r.data) img.setAttribute("src", r.data);
    if (r.kind === "video") {
      appendStyle(img, `object-fit:${r.objectFit};object-position:${r.objectPosition};`);
      if (!r.data) appendStyle(img, "background:#000;");
    } else {
      appendStyle(img, `width:${r.w}px;height:${r.h}px;`);
    }
    el.replaceWith(img);
  }

  for (const el of q("[data-fx-hover]")) {
    el.removeAttribute("data-fx-hover");
    el.classList.add("fx-hover");
  }
  for (const [attr, cls] of [
    ["data-fx-focus", "fx-focus"],
    ["data-fx-focus-visible", "fx-focus-visible"],
    ["data-fx-focus-within", "fx-focus-within"],
  ]) {
    for (const el of q(`[${attr}]`)) {
      el.removeAttribute(attr);
      el.classList.add(cls);
    }
  }
  for (const el of q("[data-fx-value]")) {
    const v = el.getAttribute("data-fx-value");
    el.removeAttribute("data-fx-value");
    if (el.tagName === "TEXTAREA") el.textContent = v;
    else el.setAttribute("value", v);
  }
  for (const el of q("[data-fx-checked]")) {
    const on = el.getAttribute("data-fx-checked") === "1";
    el.removeAttribute("data-fx-checked");
    if (on) el.setAttribute("checked", "");
    else el.removeAttribute("checked");
  }
  for (const el of q("[data-fx-select]")) {
    const idx = Number(el.getAttribute("data-fx-select"));
    el.removeAttribute("data-fx-select");
    Array.from(el.querySelectorAll("option")).forEach((o, i) => {
      if (i === idx) o.setAttribute("selected", "");
      else o.removeAttribute("selected");
    });
  }
  for (const el of q("[data-fx-scroller]")) {
    el.removeAttribute("data-fx-scroller");
    appendStyle(el, "overflow:hidden !important;");
  }
  for (const el of q("[data-fx-shift]")) {
    const { dx, dy, t, sticky } = JSON.parse(el.getAttribute("data-fx-shift"));
    el.removeAttribute("data-fx-shift");
    if (sticky) appendStyle(el, "position:relative !important;");
    appendStyle(el, `transform:translate(${dx}px, ${dy}px) ${t} !important;`);
  }

  // Inline-style urls
  for (const el of [htmlClone, ...q("[style*='url(']")].filter((e) => (e.getAttribute("style") || "").includes("url("))) {
    let style = el.getAttribute("style");
    for (const [u, p] of urlCache) {
      const data = await p.catch(() => null);
      if (data) style = style.split(u).join(data);
    }
    el.setAttribute("style", style);
  }

  // No scripts, no external links, no stray styles (all CSS goes in one tag)
  for (const el of q("script, link, style, noscript, iframe")) el.remove();

  const bg =
    opts.background && opts.background !== "auto"
      ? opts.background
      : bodyBg && bodyBg !== "rgba(0, 0, 0, 0)"
        ? bodyBg
        : "transparent";
  const bgImage = opts.backgroundImage ? await fetchDataURL(opts.backgroundImage) : null;
  const bgCss = bgImage
    ? `background:${bg} url("${bgImage}") center / cover no-repeat !important;`
    : `background:${bg} !important;`;

  const frameCss = `
html, body { width:${width}px !important; height:${height}px !important; min-width:${width}px; margin:0 !important; overflow:hidden !important; ${bgCss} }
.board { position:relative; width:${width}px; height:${height}px; overflow:hidden; ${bgCss} }
.board > #root { width:100%; height:100%; }
*, *::before, *::after { transition:none !important; animation:none !important; caret-color:transparent !important; }
`;

  const head = htmlClone.querySelector("head");
  const body = htmlClone.querySelector("body");
  const attrs = (el) =>
    Array.from(el.attributes)
      .map((a) => ` ${a.name}="${a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
      .join("");
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  void head;

  return `<!doctype html>
<html${attrs(htmlClone)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, height=${height}, initial-scale=1">
<title>${esc(name)}</title>
<style>${css.replace(/<\/style/gi, "<\\/style")}</style>
<style>${frameCss}</style>
</head>
<body${attrs(body)}>
<div class="board" data-name="${esc(name)}">${body.innerHTML}</div>
</body>
</html>
`;
}
