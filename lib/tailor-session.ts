import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureGit, getProjectState, git } from "./project";

export type StoredTailorResult = {
  tailored_latex: string;
  changes: string[];
  matched_keywords: string[];
  warnings: string[];
};

export type StoredTailorSession = {
  version: 2;
  id: string;
  name: string;
  branch: string;
  sourceLatex: string;
  jobDescription: string;
  verifiedFacts: string;
  result: StoredTailorResult;
  createdAt: string;
  updatedAt: string;
  opportunity?: TailorOpportunityLink;
};

export type TailorOpportunityLink = { id: string; company: string; role: string };

export type TailorVariantSummary = Pick<StoredTailorSession, "id" | "name" | "branch" | "createdAt" | "updatedAt" | "opportunity"> & { pdfAvailable: boolean };

type LegacyTailorSession = Omit<StoredTailorSession, "version" | "id" | "name"> & { version: 1 };

const SESSION_ROOT = join(/*turbopackIgnore: true*/ process.cwd(), "data", "tailor-sessions");
const ACTIVE_PATH = join(/*turbopackIgnore: true*/ process.cwd(), "data", "tailor-sessions", "active.json");
const ID_PATTERN = /^[A-Za-z0-9-]{1,80}$/;

async function currentBranch() {
  const project = await getProjectState();
  if (!project.exists) return "standalone";
  await ensureGit(project.directory);
  try { return (await git(project.directory, ["branch", "--show-current"])) || "main"; }
  catch { return "main"; }
}

function validateId(id: unknown) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new Error("Invalid application variant.");
  return id;
}

function pathsForId(id: string) {
  const safeId = validateId(id);
  return {
    json: join(/*turbopackIgnore: true*/ process.cwd(), "data", "tailor-sessions", `${safeId}.json`),
    pdf: join(/*turbopackIgnore: true*/ process.cwd(), "data", "tailor-sessions", `${safeId}.pdf`),
  };
}

function deriveName(jobDescription: string) {
  const firstLine = jobDescription.split("\n").map((line) => line.trim()).find(Boolean) || "Untitled application";
  const cleaned = firstLine.replace(/^[#*\s]+|[#*:]+$/g, "").replace(/[*_`]/g, "").trim();
  return (cleaned || "Untitled application").slice(0, 90);
}

function cleanName(name: unknown, jobDescription: string) {
  if (typeof name !== "string" || !name.trim()) return deriveName(jobDescription);
  if (name.trim().length > 90 || /[\r\n]/.test(name)) throw new Error("Use a variant name between 1 and 90 characters.");
  return name.trim();
}

async function atomicWrite(path: string, contents: string | Buffer) {
  await mkdir(SESSION_ROOT, { recursive: true });
  const temporary = join(/*turbopackIgnore: true*/ process.cwd(), "data", "tailor-sessions", `.${randomUUID()}.tmp`);
  await writeFile(temporary, contents, typeof contents === "string" ? "utf8" : undefined);
  await rename(temporary, path);
}

async function readActiveId() {
  try {
    const value = JSON.parse(await readFile(ACTIVE_PATH, "utf8")) as { id?: unknown };
    return typeof value.id === "string" && ID_PATTERN.test(value.id) ? value.id : null;
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== "ENOENT") throw reason;
    return null;
  }
}

async function setActiveId(id: string | null) {
  if (!id) { await rm(ACTIVE_PATH, { force: true }); return; }
  await atomicWrite(ACTIVE_PATH, JSON.stringify({ id: validateId(id) }, null, 2));
}

async function loadSessions() {
  await mkdir(SESSION_ROOT, { recursive: true });
  const files = (await readdir(SESSION_ROOT)).filter((file) => file.endsWith(".json") && file !== "active.json" && !file.startsWith("."));
  const loaded = await Promise.all(files.map(async (file) => {
    const id = file.slice(0, -5);
    if (!ID_PATTERN.test(id)) return null;
    try {
      const parsed = JSON.parse(await readFile(pathsForId(id).json, "utf8")) as StoredTailorSession | LegacyTailorSession;
      if ((parsed.version !== 1 && parsed.version !== 2) || typeof parsed.jobDescription !== "string" || typeof parsed.sourceLatex !== "string" || !parsed.result) return null;
      const session: StoredTailorSession = {
        ...parsed,
        version: 2,
        id,
        name: parsed.version === 2 ? cleanName(parsed.name, parsed.jobDescription) : deriveName(parsed.jobDescription),
        verifiedFacts: typeof parsed.verifiedFacts === "string" ? parsed.verifiedFacts : "",
      };
      return session;
    } catch { return null; }
  }));
  return loaded.filter((session): session is StoredTailorSession => Boolean(session)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function summaries(sessions: StoredTailorSession[]) {
  return Promise.all(sessions.map(async ({ id, name, branch, createdAt, updatedAt, opportunity }) => ({
    id, name, branch, createdAt, updatedAt, opportunity,
    pdfAvailable: await stat(pathsForId(id).pdf).then((entry) => entry.isFile()).catch(() => false),
  })));
}

export async function readTailorSession(requestedId?: string | null) {
  const branch = await currentBranch();
  const sessions = await loadSessions();
  const activeId = requestedId ? validateId(requestedId) : await readActiveId();
  const session = sessions.find((item) => item.id === activeId) || (!requestedId ? sessions[0] : null) || null;
  const variants = await summaries(sessions);
  const pdfAvailable = session ? variants.find((variant) => variant.id === session.id)?.pdfAvailable || false : false;
  return { branch, session, pdfAvailable, variants };
}

export async function activateTailorSession(id: string) {
  const stored = await readTailorSession(validateId(id));
  if (!stored.session) throw new Error("That application variant no longer exists.");
  await setActiveId(stored.session.id);
  return stored;
}

export async function writeTailorSession(input: Pick<StoredTailorSession, "sourceLatex" | "jobDescription" | "verifiedFacts" | "result"> & { id?: string; name?: string; opportunity?: TailorOpportunityLink }) {
  const sessions = await loadSessions();
  const id = input.id ? validateId(input.id) : randomUUID();
  const existing = sessions.find((session) => session.id === id);
  const now = new Date().toISOString();
  const session: StoredTailorSession = {
    version: 2,
    id,
    name: cleanName(input.name || existing?.name, input.jobDescription),
    branch: existing?.branch || await currentBranch(),
    sourceLatex: input.sourceLatex,
    jobDescription: input.jobDescription,
    verifiedFacts: input.verifiedFacts,
    result: input.result,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    opportunity: input.opportunity || existing?.opportunity,
  };
  const paths = pathsForId(id);
  await atomicWrite(paths.json, JSON.stringify(session, null, 2));
  await rm(paths.pdf, { force: true });
  await setActiveId(id);
  return session;
}

export async function renameTailorSession(id: string, name: string) {
  const stored = await readTailorSession(validateId(id));
  if (!stored.session) throw new Error("That application variant no longer exists.");
  const session = { ...stored.session, name: cleanName(name, stored.session.jobDescription), updatedAt: new Date().toISOString() };
  await atomicWrite(pathsForId(id).json, JSON.stringify(session, null, 2));
  await setActiveId(id);
  return session;
}

export async function linkTailorSession(id: string, opportunity: TailorOpportunityLink) {
  const safeId = validateId(id);
  const sessions = await loadSessions();
  const existing = sessions.find((session) => session.id === safeId);
  if (!existing) throw new Error("That application variant no longer exists.");
  const conflict = sessions.find((session) => session.id !== safeId && session.opportunity?.id === opportunity.id);
  if (conflict) throw new Error(`That Searchboard lead is already linked to “${conflict.name}”.`);
  const session = { ...existing, opportunity, updatedAt: new Date().toISOString() };
  await atomicWrite(pathsForId(safeId).json, JSON.stringify(session, null, 2));
  await setActiveId(safeId);
  return session;
}

export async function writeTailorPdf(pdf: Buffer, id: string) {
  const stored = await readTailorSession(validateId(id));
  if (!stored.session) throw new Error("Save the application variant before its PDF.");
  await atomicWrite(pathsForId(id).pdf, pdf);
  await setActiveId(id);
  return stored.session;
}

export async function readTailorPdf(id?: string | null) {
  const stored = await readTailorSession(id);
  if (!stored.session) throw Object.assign(new Error("No saved tailored PDF."), { code: "ENOENT" });
  return readFile(pathsForId(stored.session.id).pdf);
}

export async function deleteTailorSession(id: string) {
  const safeId = validateId(id);
  const paths = pathsForId(safeId);
  await Promise.all([rm(paths.json, { force: true }), rm(paths.pdf, { force: true })]);
  const remaining = await loadSessions();
  await setActiveId(remaining[0]?.id || null);
  return { id: safeId, activeId: remaining[0]?.id || null };
}
