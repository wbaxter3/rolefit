import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA_ROOT = join(/*turbopackIgnore: true*/ process.cwd(), "data");
const APPLICATIONS_PATH = join(/*turbopackIgnore: true*/ process.cwd(), "data", "extension-applications.json");
const PROFILE_PATH = join(/*turbopackIgnore: true*/ process.cwd(), "data", "extension-profile.json");
const OPPORTUNITY_PATTERN = /^[A-Za-z0-9-]{1,120}$/;

export type ExtensionApplicationRecord = {
  version: 1;
  id: string;
  canonicalUrl: string;
  opportunityId?: string;
  company: string;
  role: string;
  location: string;
  compensation: string;
  jobDescription: string;
  variantId?: string;
  variantName?: string;
  mode?: string;
  filename: string;
  downloadUrl: string;
  roleFitUrl: string;
  attachment?: Record<string, unknown>;
  autofill?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type ApplicationStore = { version: 1; updatedAt: string; applications: ExtensionApplicationRecord[] };
type ProfileStore = { version: 1; updatedAt: string; importedAt?: string; profile: Record<string, unknown> };

let applicationWriteQueue = Promise.resolve();
let profileWriteQueue = Promise.resolve();

function clean(value: unknown, maximum = 2_000) {
  return typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, maximum) : "";
}

function safeObject(value: unknown, maximumBytes = 250_000) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) throw new Error("Saved extension data is too large.");
  return JSON.parse(serialized) as Record<string, unknown>;
}

export function canonicalApplicationUrl(value: unknown) {
  const raw = clean(value, 4_000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/application$/i, "") || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  }
}

function recordId(opportunityId: string, canonicalUrl: string, company: string, role: string) {
  const identity = opportunityId ? `opportunity:${opportunityId}` : canonicalUrl ? `url:${canonicalUrl}` : `role:${company}\n${role}`;
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

async function atomicWrite(path: string, contents: string) {
  await mkdir(DATA_ROOT, { recursive: true });
  const temporary = join(/*turbopackIgnore: true*/ DATA_ROOT, `.${randomUUID()}.tmp`);
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path);
}

async function readApplications(): Promise<ApplicationStore> {
  try {
    const parsed = JSON.parse(await readFile(APPLICATIONS_PATH, "utf8")) as ApplicationStore;
    if (parsed.version === 1 && Array.isArray(parsed.applications)) return parsed;
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== "ENOENT") throw reason;
  }
  return { version: 1, updatedAt: new Date(0).toISOString(), applications: [] };
}

export async function findExtensionApplication(query: { url?: unknown; opportunityId?: unknown; company?: unknown; role?: unknown } = {}) {
  const store = await readApplications();
  const opportunityId = clean(query.opportunityId, 120);
  const canonicalUrl = canonicalApplicationUrl(query.url);
  const company = clean(query.company, 200).toLowerCase();
  const role = clean(query.role, 300).toLowerCase();
  return store.applications.find((item) => opportunityId && item.opportunityId === opportunityId)
    || store.applications.find((item) => canonicalUrl && item.canonicalUrl === canonicalUrl)
    || store.applications.find((item) => company && role && item.company.toLowerCase() === company && item.role.toLowerCase() === role)
    || (!opportunityId && !canonicalUrl && !company && !role ? store.applications[0] : null)
    || null;
}

export async function writeExtensionApplication(input: Record<string, unknown>) {
  let written: ExtensionApplicationRecord | null = null;
  applicationWriteQueue = applicationWriteQueue.then(async () => {
    const store = await readApplications();
    const now = new Date().toISOString();
    const canonicalUrl = canonicalApplicationUrl(input.url ?? input.canonicalUrl);
    const requestedOpportunityId = clean(input.opportunityId, 120);
    const opportunityId = OPPORTUNITY_PATTERN.test(requestedOpportunityId) ? requestedOpportunityId : "";
    const company = clean(input.company, 200);
    const role = clean(input.role, 300);
    if (!canonicalUrl && !opportunityId && (!company || !role)) throw new Error("An application needs a stable job identity.");
    const existing = store.applications.find((item) => opportunityId && item.opportunityId === opportunityId)
      || store.applications.find((item) => canonicalUrl && item.canonicalUrl === canonicalUrl)
      || null;
    written = {
      version: 1,
      id: existing?.id || recordId(opportunityId, canonicalUrl, company, role),
      canonicalUrl: canonicalUrl || existing?.canonicalUrl || "",
      ...(opportunityId || existing?.opportunityId ? { opportunityId: opportunityId || existing?.opportunityId } : {}),
      company: company || existing?.company || "",
      role: role || existing?.role || "",
      location: clean(input.location, 300) || existing?.location || "",
      compensation: clean(input.compensation, 300) || existing?.compensation || "",
      jobDescription: clean(input.jobDescription, 100_000) || existing?.jobDescription || "",
      ...(clean(input.variantId, 120) || existing?.variantId ? { variantId: clean(input.variantId, 120) || existing?.variantId } : {}),
      ...(clean(input.variantName, 200) || existing?.variantName ? { variantName: clean(input.variantName, 200) || existing?.variantName } : {}),
      ...(clean(input.mode, 40) || existing?.mode ? { mode: clean(input.mode, 40) || existing?.mode } : {}),
      filename: clean(input.filename, 240) || existing?.filename || "",
      downloadUrl: clean(input.downloadUrl, 4_000) || existing?.downloadUrl || "",
      roleFitUrl: clean(input.roleFitUrl, 4_000) || existing?.roleFitUrl || "",
      attachment: Object.keys(safeObject(input.attachment, 20_000)).length ? safeObject(input.attachment, 20_000) : existing?.attachment,
      autofill: Object.keys(safeObject(input.autofill, 40_000)).length ? safeObject(input.autofill, 40_000) : existing?.autofill,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const applications = [written, ...store.applications.filter((item) => item.id !== existing?.id && item.id !== written?.id)].slice(0, 500);
    await atomicWrite(APPLICATIONS_PATH, JSON.stringify({ version: 1, updatedAt: now, applications }, null, 2));
  });
  await applicationWriteQueue;
  if (!written) throw new Error("Could not save the application record.");
  return written;
}

export async function readExtensionProfile() {
  try {
    const parsed = JSON.parse(await readFile(PROFILE_PATH, "utf8")) as ProfileStore;
    if (parsed.version === 1 && parsed.profile && typeof parsed.profile === "object") return parsed;
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== "ENOENT") throw reason;
  }
  return null;
}

export async function writeExtensionProfile(profile: unknown, importedAt?: unknown) {
  let written: ProfileStore | null = null;
  profileWriteQueue = profileWriteQueue.then(async () => {
    const existing = await readExtensionProfile();
    written = {
      version: 1,
      updatedAt: new Date().toISOString(),
      ...(clean(importedAt, 80) || existing?.importedAt ? { importedAt: clean(importedAt, 80) || existing?.importedAt } : {}),
      profile: safeObject(profile, 500_000),
    };
    await atomicWrite(PROFILE_PATH, JSON.stringify(written, null, 2));
  });
  await profileWriteQueue;
  if (!written) throw new Error("Could not save the extension profile.");
  return written;
}
