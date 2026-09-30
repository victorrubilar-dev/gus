// Prism, el mismo motor de resaltado que usa Obsidian en su vista de lectura.
// Los componentes se importan en orden de dependencias (clike → javascript →
// jsx/typescript → tsx, markup → markdown, c → cpp/objectivec, etc.); los
// alias (js, py, sh, html…) los registra cada componente al cargarse.
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-php";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-lua";
import "prismjs/components/prism-r";
import "prismjs/components/prism-scala";
import "prismjs/components/prism-perl";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-dart";
import "prismjs/components/prism-elixir";
import "prismjs/components/prism-haskell";
import "prismjs/components/prism-makefile";
import "prismjs/components/prism-batch";
import "prismjs/components/prism-objectivec";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-ini";

/** Nombres cortos frecuentes en las vallas de la gente. */
const ALIASES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  node: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  html: "markup",
  xml: "markup",
  svg: "markup",
  md: "markdown",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  rs: "rust",
  kt: "kotlin",
  objc: "objectivec",
  dockerfile: "docker",
  console: "bash",
  terminal: "bash",
  text: "markup",
  plain: "markup",
  txt: "markup",
};

/**
 * Resalta `source` y devuelve el HTML con los spans `.token` de Prism.
 *
 * Devuelve `null` si el lenguaje es desconocido o Prism falla: quien llama
 * pinta entonces el texto plano, que es exactamente lo que hace Obsidian
 * cuando no encuentra gramática.
 */
export function highlightCode(source: string, language: string): string | null {
  const key = language.toLowerCase();
  const id = ALIASES[key] ?? key;
  const grammar = Prism.languages[id];
  if (!grammar) return null;

  try {
    return Prism.highlight(source, grammar, id);
  } catch {
    return null;
  }
}
