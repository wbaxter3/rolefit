import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { extensionOptions, extensionRequestAllowed, extensionResponseHeaders } from "../../../../lib/extension-access";
import { getProjectState, safeProjectPath } from "../../../../lib/project";
import { writeTailorPdf, writeTailorSession, type StoredTailorResult } from "../../../../lib/tailor-session";

export const runtime = "nodejs";
export const maxDuration = 240;

function cleanLabel(value: unknown, fallback: string, maxLength = 100) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, maxLength);
}

function filenamePart(value: string, fallback: string) {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return cleaned || fallback;
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

export async function OPTIONS(request: Request) {
  return extensionOptions(request);
}

export async function POST(request: Request) {
  const corsHeaders = extensionResponseHeaders(request);
  try {
    if (!extensionRequestAllowed(request, "create-resume")) {
      return NextResponse.json({ error: "Request not allowed." }, { status: 403, headers: corsHeaders });
    }

    const body = await request.json();
    const company = cleanLabel(body.company, "Company");
    const role = cleanLabel(body.role, "Target role");
    const candidateName = cleanLabel(body.candidateName, "Candidate", 80);
    const jobDescription = typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";
    const verifiedFacts = typeof body.verifiedFacts === "string" ? body.verifiedFacts.trim().slice(0, 20_000) : "";
    const tailoringMode = body.tailoringMode === "light" ? "light" : "full";
    if (jobDescription.length < 80) {
      return NextResponse.json({ error: "The extracted job description is too short. Add more of the posting in the extension." }, { status: 400, headers: corsHeaders });
    }
    if (jobDescription.length > 100_000) {
      return NextResponse.json({ error: "The job description is too large." }, { status: 400, headers: corsHeaders });
    }

    const project = await getProjectState();
    if (!project.exists) {
      return NextResponse.json({ error: "Import your main resume project in RoleFit Studio first." }, { status: 404, headers: corsHeaders });
    }
    const sourceLatex = await readFile(safeProjectPath(project.directory, project.mainFile), "utf8");
    const origin = new URL(request.url).origin;

    const tailoredResponse = await fetch(`${origin}/api/tailor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latex: sourceLatex, jobDescription, verifiedFacts, tailoringMode }),
      cache: "no-store",
    });
    if (!tailoredResponse.ok) {
      throw new Error(await responseError(tailoredResponse, "RoleFit could not tailor the resume."));
    }
    const result = await tailoredResponse.json() as StoredTailorResult;

    const compiledResponse = await fetch(`${origin}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latex: result.tailored_latex }),
      cache: "no-store",
    });
    if (!compiledResponse.ok) {
      throw new Error(await responseError(compiledResponse, "RoleFit tailored the resume but could not compile its PDF."));
    }

    const opportunityId = typeof body.opportunityId === "string" && /^[A-Za-z0-9-]{1,120}$/.test(body.opportunityId)
      ? body.opportunityId
      : undefined;
    const session = await writeTailorSession({
      name: `${company} — ${role}${tailoringMode === "light" ? " · Light" : ""}`,
      sourceLatex,
      jobDescription,
      verifiedFacts,
      result,
      opportunity: opportunityId ? { id: opportunityId, company, role } : undefined,
    });
    await writeTailorPdf(Buffer.from(await compiledResponse.arrayBuffer()), session.id);

    const filename = `${filenamePart(candidateName, "Candidate")}_${filenamePart(company, "Company")}_Resume.pdf`;
    return NextResponse.json({
      id: session.id,
      filename,
      mode: tailoringMode,
      changes: result.changes,
      matchedKeywords: result.matched_keywords,
      warnings: result.warnings,
      downloadUrl: `${origin}/api/tailor/session/pdf?id=${encodeURIComponent(session.id)}`,
      roleFitUrl: origin,
    }, { headers: corsHeaders });
  } catch (reason) {
    console.error("Extension tailoring failed:", reason);
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not create the tailored resume." }, { status: 500, headers: corsHeaders });
  }
}
