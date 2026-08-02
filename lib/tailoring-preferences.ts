import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA_ROOT = join(/* turbopackIgnore: true */ process.cwd(), "data");
const PREFERENCES_PATH = join(/* turbopackIgnore: true */ DATA_ROOT, "tailoring-preferences.json");
const MAX_RULES = 100;
const MAX_RULE_LENGTH = 2_000;
const MAX_TOTAL_LENGTH = 20_000;

export type TailoringPreferences = {
  version: 1;
  updatedAt: string;
  rules: string[];
};

let writeQueue = Promise.resolve();

function cleanRule(value: unknown) {
  return typeof value === "string"
    ? value.replace(/\0/g, "").replace(/\s+/g, " ").replace(/^[-*•]\s*/, "").trim().slice(0, MAX_RULE_LENGTH)
    : "";
}

function normalizeRules(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Tailoring preferences must be a list.");
  const seen = new Set<string>();
  const rules: string[] = [];
  let totalLength = 0;
  for (const entry of value.slice(0, MAX_RULES)) {
    const rule = cleanRule(entry);
    const key = rule.toLowerCase();
    if (!rule || seen.has(key)) continue;
    if (totalLength + rule.length > MAX_TOTAL_LENGTH) throw new Error("Tailoring preferences are too large.");
    seen.add(key);
    rules.push(rule);
    totalLength += rule.length;
  }
  return rules;
}

async function atomicWrite(contents: string) {
  await mkdir(DATA_ROOT, { recursive: true });
  const temporary = join(/* turbopackIgnore: true */ DATA_ROOT, `.tailoring-preferences.${randomUUID()}.tmp`);
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, PREFERENCES_PATH);
}

export async function readTailoringPreferences(): Promise<TailoringPreferences> {
  try {
    const parsed = JSON.parse(await readFile(PREFERENCES_PATH, "utf8")) as TailoringPreferences;
    if (parsed.version === 1 && Array.isArray(parsed.rules)) return { ...parsed, rules: normalizeRules(parsed.rules) };
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== "ENOENT") throw reason;
  }
  return { version: 1, updatedAt: new Date(0).toISOString(), rules: [] };
}

export async function writeTailoringPreferences(value: unknown) {
  const rules = normalizeRules(value);
  let written: TailoringPreferences | null = null;
  writeQueue = writeQueue.then(async () => {
    written = { version: 1, updatedAt: new Date().toISOString(), rules };
    await atomicWrite(`${JSON.stringify(written, null, 2)}\n`);
  });
  await writeQueue;
  if (!written) throw new Error("Could not save tailoring preferences.");
  return written;
}

export async function appendTailoringFeedback(value: unknown) {
  const feedback = cleanRule(value);
  if (feedback.length < 3) throw new Error("Write at least three characters of reusable feedback.");
  const existing = await readTailoringPreferences();
  return writeTailoringPreferences([...existing.rules, feedback]);
}
