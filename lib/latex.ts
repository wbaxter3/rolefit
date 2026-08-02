import { access } from "node:fs/promises";
import { constants } from "node:fs";

export const MAX_LATEX_LENGTH = 500_000;

const blockedCommands = [
  /\\write18\b/i,
  /\\openin\b/i,
  /\\openout\b/i,
  /\\read\b/i,
  /\\(?:input|include|includegraphics)\s*(?:\[[^\]]*\])?\s*\{?\s*(?:\.\.[/\\]|[~/])/i,
];

export function validateLatex(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error("LaTeX source is required.");
  if (value.length > MAX_LATEX_LENGTH) throw new Error("LaTeX source is too large (500 KB maximum).");
  if (!/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/.test(value)) throw new Error("This does not look like a complete LaTeX document. Include \\documentclass and the full document.");
  if (!/\\begin\{document\}/.test(value) || !/\\end\{document\}/.test(value)) throw new Error("The LaTeX source needs a complete document environment.");
  if (blockedCommands.some((pattern) => pattern.test(value))) throw new Error("The document uses a file or shell command that local safe compilation does not allow.");
}

export function normalizeTailoredLatex(latex: string) {
  return latex.replace(/\\quad\s*\|\s*\\quad/g, "\\hfill ");
}

export async function findCompiler() {
  const candidates = [
    ["tectonic", "/opt/homebrew/bin/tectonic"],
    ["tectonic", "/usr/local/bin/tectonic"],
    ["pdflatex", "/Library/TeX/texbin/pdflatex"],
    ["pdflatex", "/usr/bin/pdflatex"],
  ] as const;
  for (const [name, path] of candidates) {
    try { await access(path, constants.X_OK); return { name, path }; } catch { /* continue */ }
  }
  return null;
}
