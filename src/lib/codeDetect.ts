/** Detect programming language from clipboard text. */
export type DetectedLanguage =
  | "rust"
  | "csharp"
  | "java"
  | "typescript"
  | "javascript"
  | "python"
  | "html"
  | "css"
  | "json"
  | "sql"
  | "go"
  | "code"
  | "plain";

export function detectLanguage(text: string | null | undefined): DetectedLanguage {
  if (!text) return "plain";
  const trimmed = text.trim();
  if (trimmed.length < 6) return "plain";

  // Fenced blocks: ```rust
  const fence = trimmed.match(/^```(\w+)/);
  if (fence) {
    const lang = fence[1].toLowerCase();
    if (lang === "rs" || lang === "rust") return "rust";
    if (lang === "cs" || lang === "csharp") return "csharp";
    if (lang === "ts" || lang === "tsx" || lang === "typescript") return "typescript";
    if (lang === "js" || lang === "jsx" || lang === "javascript") return "javascript";
    if (lang === "py" || lang === "python") return "python";
    if (lang === "html" || lang === "xml") return "html";
    if (lang === "css" || lang === "scss") return "css";
    if (lang === "json") return "json";
    if (lang === "sql") return "sql";
    if (lang === "go" || lang === "golang") return "go";
    if (lang === "java") return "java";
    return "code";
  }

  // Rust
  if (/fn\s+\w+|let\s+mut|println!|#\[derive|pub\s+fn|impl\s+\w+|use\s+std::|::\s*</.test(text)) {
    return "rust";
  }

  // C#
  if (
    /using\s+System[.;]|namespace\s+\w+|Console\.WriteLine|string\s*\[\]|public\s+(partial\s+)?class/.test(
      text
    ) &&
    !/import\s+java\./.test(text)
  ) {
    return "csharp";
  }

  // Java
  if (
    /public\s+class\s+\w+|System\.out\.println|public\s+static\s+void\s+main|import\s+java\./.test(
      text
    )
  ) {
    return "java";
  }

  // Go
  if (/package\s+main|func\s+\w+\(|fmt\.Println|:=\s*/.test(text) && /package\s+\w+/.test(text)) {
    return "go";
  }

  // JSON
  if (
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    /"\w+"\s*:/.test(trimmed) &&
    !/<[a-z]/i.test(trimmed)
  ) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      /* continue */
    }
  }

  // SQL
  if (/\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|CREATE\s+TABLE|DELETE\s+FROM)\b/i.test(text)) {
    return "sql";
  }

  // HTML / XML
  if (
    /<\/?[a-z][\s\S]*>/i.test(trimmed) &&
    (trimmed.startsWith("<") || trimmed.includes("<!DOCTYPE") || /<\/\w+>/.test(trimmed))
  ) {
    return "html";
  }

  // CSS
  if (/[.#]?[\w-]+\s*\{[^}]*[\w-]+\s*:\s*[^;]+;/.test(text) && !/function\s|const\s|def\s/.test(text)) {
    return "css";
  }

  // Python
  if (/def\s+\w+\(.*\):|from\s+\w+\s+import|elif\s+|print\(|^\s*@\w+/m.test(text)) {
    return "python";
  }

  // TypeScript / JavaScript / React
  if (
    /const\s+\w+\s*=|import\s+.+from|console\.log|export\s+default|function\s+\w+\(|=>\s*[{(]|useState|useEffect/.test(
      text
    )
  ) {
    if (
      /:\s*(string|number|boolean|void|any|unknown|React\.|FC<)|interface\s+\w+|type\s+\w+\s*=|as\s+const/.test(
        text
      )
    ) {
      return "typescript";
    }
    return "javascript";
  }

  // Generic code
  if (
    text.includes("```") ||
    (text.includes("{") && text.includes("}") && (text.includes(";") || text.includes("=>")))
  ) {
    return "code";
  }

  return "plain";
}

export function isCodeSnippet(content: string, contentType: string): boolean {
  if (contentType !== "text") return false;
  if (detectLanguage(content) !== "plain") return true;
  const t = content.trim();
  if (t.length < 4) return false;
  const markers = ["function", "const", "import", "fn", "class", "def", "var", "let"];
  if (markers.some((m) => t.includes(m))) return true;
  if (t.includes("{") && t.includes("}")) return true;
  return false;
}

export function stripCodeFences(content: string): string {
  return content
    .replace(/^```[\w+-]*\n?/, "")
    .replace(/\n?```$/, "")
    .trimEnd();
}

export function codePreview(content: string, maxLines = 8): string {
  const cleaned = stripCodeFences(content);
  const lines = cleaned.split("\n");
  if (lines.length <= maxLines) return cleaned;
  return `${lines.slice(0, maxLines).join("\n")}\n…`;
}

export function languageLabel(lang: DetectedLanguage): string {
  const map: Record<DetectedLanguage, string> = {
    rust: "Rust",
    csharp: "C#",
    java: "Java",
    typescript: "TypeScript",
    javascript: "JavaScript",
    python: "Python",
    html: "HTML",
    css: "CSS",
    json: "JSON",
    sql: "SQL",
    go: "Go",
    code: "Code",
    plain: "Text",
  };
  return map[lang];
}

export function highlighterLanguage(lang: DetectedLanguage): string {
  const map: Record<DetectedLanguage, string> = {
    rust: "rust",
    csharp: "csharp",
    java: "java",
    typescript: "typescript",
    javascript: "javascript",
    python: "python",
    html: "markup",
    css: "css",
    json: "json",
    sql: "sql",
    go: "go",
    code: "javascript",
    plain: "text",
  };
  return map[lang];
}
