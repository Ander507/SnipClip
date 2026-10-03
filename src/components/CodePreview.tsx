import { useSyncExternalStore } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, prism } from "react-syntax-highlighter/dist/esm/styles/prism";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import {
  codePreview,
  detectLanguage,
  highlighterLanguage,
  stripCodeFences,
} from "../lib/codeDetect";

// The default `Prism` export ships every grammar Prism supports and cost ~640 kB of the
// bundle. These are exactly the grammars `highlighterLanguage` can return; each one pulls
// in its own base grammar (csharp/java need clike, typescript needs javascript).
for (const language of [
  markup,
  css,
  javascript,
  typescript,
  csharp,
  go,
  java,
  json,
  python,
  rust,
  sql,
  bash,
]) {
  SyntaxHighlighter.registerLanguage(language.displayName, language);
}

type CodeStyle = typeof prism;

// Token highlights (prism's operator/entity/url get a white wash) turn into grey boxes on the
// inset; the block supplies its own background.
function withoutBackgrounds(style: CodeStyle): CodeStyle {
  return Object.fromEntries(
    Object.entries(style).map(([key, value]) => [key, { ...value, background: undefined }])
  );
}

const LIGHT_STYLE = withoutBackgrounds(prism);
const DARK_STYLE = withoutBackgrounds(oneDark);

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

// index.css treats a missing data-theme as dark.
const isDarkTheme = () => document.documentElement.dataset.theme !== "light";

/** Line box and vertical padding of the rendered block, for row height estimates. */
export const CODE_LINE_PX = 18;
export const CODE_PAD_PX = 8;

/** Height the block settles at for `content` (long snippets end in a "…" line). */
export function codeBlockHeight(content: string, maxLines: number): number {
  const lines = Math.min(stripCodeFences(content).split("\n").length, maxLines + 1);
  return lines * CODE_LINE_PX + CODE_PAD_PX * 2;
}

interface Props {
  content: string;
  /** Lines shown before the snippet is cut with "…". */
  maxLines?: number;
}

export function CodePreview({ content, maxLines = 8 }: Props) {
  const lang = detectLanguage(content);
  const hlLang = highlighterLanguage(lang);
  const code = codePreview(stripCodeFences(content), maxLines);
  const dark = useSyncExternalStore(subscribeTheme, isDarkTheme);

  return (
    <div
      className="my-0.5 overflow-auto rounded-md bg-inset"
      style={{ maxHeight: (maxLines + 1) * CODE_LINE_PX + CODE_PAD_PX * 2 }}
    >
      <SyntaxHighlighter
        language={hlLang}
        style={dark ? DARK_STYLE : LIGHT_STYLE}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: `${CODE_PAD_PX}px 10px`,
          fontSize: "12px",
          lineHeight: `${CODE_LINE_PX}px`,
          background: "transparent",
          color: "var(--color-fg-secondary)",
          textShadow: "none",
          overflow: "visible",
        }}
        codeTagProps={{
          style: { fontFamily: "var(--font-mono)" },
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
