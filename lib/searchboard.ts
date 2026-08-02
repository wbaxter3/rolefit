import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type SearchboardOpportunity = {
  id: string;
  company: string;
  role: string;
  stage: "Lead" | "Applied" | "Interview" | "Offer" | "Closed";
  source: string;
  location?: string;
  compensation?: string;
  techStack?: string[];
  jobDescription?: string;
  linkedinSummary?: string;
  lastActivity: string;
  action?: string;
  summary: string;
  emailUrl?: string;
};

const MAX_DATA_BYTES = 10_000_000;

export function searchboardDataPath() {
  return process.env.SEARCHBOARD_DATA_PATH || resolve(/* turbopackIgnore: true */ process.cwd(), "..", "searchboard", "data", "opportunities.json");
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseOpportunity(value: unknown): SearchboardOpportunity | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.company !== "string" || typeof item.role !== "string" || typeof item.summary !== "string" || typeof item.lastActivity !== "string") return null;
  const stage = ["Lead", "Applied", "Interview", "Offer", "Closed"].includes(String(item.stage)) ? item.stage as SearchboardOpportunity["stage"] : "Lead";
  return {
    id: item.id,
    company: item.company,
    role: item.role,
    stage,
    source: optionalString(item.source) || "Searchboard",
    location: optionalString(item.location),
    compensation: optionalString(item.compensation),
    techStack: Array.isArray(item.techStack) ? item.techStack.filter((entry): entry is string => typeof entry === "string").slice(0, 100) : undefined,
    jobDescription: optionalString(item.jobDescription)?.slice(0, 100_000),
    linkedinSummary: optionalString(item.linkedinSummary),
    lastActivity: item.lastActivity,
    action: optionalString(item.action),
    summary: item.summary,
    emailUrl: optionalString(item.emailUrl),
  };
}

export async function readSearchboardOpportunities() {
  const contents = await readFile(/* turbopackIgnore: true */ searchboardDataPath(), "utf8");
  if (Buffer.byteLength(contents) > MAX_DATA_BYTES) throw new Error("Searchboard data is unexpectedly large.");
  const parsed = JSON.parse(contents) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Searchboard opportunities must be a JSON array.");
  return parsed.map(parseOpportunity).filter((item): item is SearchboardOpportunity => Boolean(item));
}

export function opportunityJobContext(item: SearchboardOpportunity) {
  if (item.jobDescription) {
    return [
      `${item.company} — ${item.role}`,
      item.location && `Location: ${item.location}`,
      item.compensation && `Compensation: ${item.compensation}`,
      item.techStack?.length && `Technologies: ${item.techStack.join(", ")}`,
      `\nJob description from recruiter email:\n${item.jobDescription}`,
    ].filter(Boolean).join("\n");
  }
  return [
    `${item.company} — ${item.role}`,
    `Pipeline stage: ${item.stage}`,
    item.location && `Location: ${item.location}`,
    item.compensation && `Compensation: ${item.compensation}`,
    item.techStack?.length && `Technologies: ${item.techStack.join(", ")}`,
    item.action && `Next action: ${item.action}`,
    `Opportunity summary: ${item.summary}`,
    item.linkedinSummary && `LinkedIn context: ${item.linkedinSummary}`,
    "\nAdd or replace this imported context with the complete job description before tailoring for the strongest result.",
  ].filter(Boolean).join("\n");
}
