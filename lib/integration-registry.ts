import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ensureGit, getProjectState, git } from "./project";
import type { TailorVariantSummary } from "./tailor-session";

export type IntegrationLink = {
  opportunityId: string;
  company: string;
  role: string;
  variantId: string;
  variantName: string;
  branch: string;
  pdfAvailable: boolean;
  variantUpdatedAt: string;
  gitCommit: string | null;
  gitDirty: boolean;
};

export type IntegrationRegistry = {
  version: 1;
  updatedAt: string;
  links: IntegrationLink[];
};

export function integrationRegistryPath() {
  return process.env.CAREER_REGISTRY_PATH || resolve(/* turbopackIgnore: true */ process.cwd(), "..", ".career-workspace", "integration-registry.json");
}

async function currentResumeGit() {
  const project = await getProjectState();
  if (!project.exists) return { commit: null, dirty: false };
  await ensureGit(project.directory);
  const dirty = Boolean(await git(project.directory, ["status", "--porcelain"]));
  try { return { commit: await git(project.directory, ["rev-parse", "--short", "HEAD"]) || null, dirty }; }
  catch { return { commit: null, dirty }; }
}

async function atomicWrite(registry: IntegrationRegistry) {
  const path = integrationRegistryPath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(registry, null, 2), "utf8");
  await rename(temporary, path);
}

export async function syncIntegrationRegistry(variants: TailorVariantSummary[]) {
  const resumeGit = await currentResumeGit();
  const registry: IntegrationRegistry = {
    version: 1,
    updatedAt: new Date().toISOString(),
    links: variants.flatMap((variant) => variant.opportunity ? [{
      opportunityId: variant.opportunity.id,
      company: variant.opportunity.company,
      role: variant.opportunity.role,
      variantId: variant.id,
      variantName: variant.name,
      branch: variant.branch,
      pdfAvailable: variant.pdfAvailable,
      variantUpdatedAt: variant.updatedAt,
      gitCommit: resumeGit.commit,
      gitDirty: resumeGit.dirty,
    }] : []),
  };
  await atomicWrite(registry);
  return registry;
}

export async function readIntegrationRegistry() {
  try {
    const registry = JSON.parse(await readFile(/* turbopackIgnore: true */ integrationRegistryPath(), "utf8")) as IntegrationRegistry;
    return registry.version === 1 && Array.isArray(registry.links) ? registry : null;
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw reason;
  }
}
