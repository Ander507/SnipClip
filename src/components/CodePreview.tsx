import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { prism } from "react-syntax-highlighter/dist/esm/styles/prism";
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
  languageLabel,
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
]) {
  SyntaxHighlighter.registerLanguage(language.displayName, language);
}

interface Props {
  content: string;
}

// adding react-syntax-highlighter and simple code heuristic to prettier-print code snippets in the vault
export function CodePreview({ content }: Props) {
  const lang = detectLanguage(content);
  const hlLang = highlighterLanguage(lang);
  const code = codePreview(stripCodeFences(content));

  return (
    <div className="my-0.5 overflow-hidden rounded-md border border-line bg-inset">
      <div className="flex items-center justify-between border-b border-line bg-muted px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        <span>{languageLabel(lang)}</span>
        <span className="text-fg-faint">snippet</span>
      </div>
      <div className="max-h-36 overflow-auto">
        <SyntaxHighlighter
          language={hlLang}
          style={prism}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: "10px",
            fontSize: "12px",
            lineHeight: 1.5,
            background: "transparent",
          }}
          codeTagProps={{
            style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
