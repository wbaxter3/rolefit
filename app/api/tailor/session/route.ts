import { NextResponse } from "next/server";
import { normalizeTailoredLatex, validateLatex } from "../../../../lib/latex";
import { activateTailorSession, deleteTailorSession, linkTailorSession, readTailorSession, renameTailorSession, writeTailorPdf, writeTailorSession, type StoredTailorResult } from "../../../../lib/tailor-session";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 15_000_000;

function stringList(value: unknown, name: string) {
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string" || item.length > 2_000)) throw new Error(`Invalid ${name}.`);
  return value as string[];
}

function parseResult(value: unknown): StoredTailorResult {
  if (!value || typeof value !== "object") throw new Error("A tailored result is required.");
  const result = value as Record<string, unknown>;
  if (typeof result.tailored_latex !== "string" || result.tailored_latex.length > 300_000) throw new Error("Invalid tailored LaTeX.");
  const tailoredLatex = normalizeTailoredLatex(result.tailored_latex);
  validateLatex(tailoredLatex);
  return {
    tailored_latex: tailoredLatex,
    changes: stringList(result.changes, "change summary"),
    matched_keywords: stringList(result.matched_keywords, "matched keywords"),
    warnings: stringList(result.warnings, "warnings"),
  };
}

function parseOpportunity(value: unknown) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Invalid linked opportunity.");
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 200 || typeof item.company !== "string" || !item.company.trim() || item.company.length > 200 || typeof item.role !== "string" || !item.role.trim() || item.role.length > 300) throw new Error("Invalid linked opportunity.");
  return { id: item.id.trim(), company: item.company.trim(), role: item.role.trim() };
}

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    const stored = await readTailorSession(id);
    if (!stored.session) return NextResponse.json({ exists: false, branch: stored.branch, variants: stored.variants });
    return NextResponse.json({ exists: true, ...stored.session, pdfAvailable: stored.pdfAvailable, variants: stored.variants }, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not restore the local tailoring session." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.sourceLatex !== "string" || body.sourceLatex.length > 300_000) throw new Error("Invalid source resume.");
    validateLatex(body.sourceLatex);
    if (typeof body.jobDescription !== "string" || body.jobDescription.trim().length < 80 || body.jobDescription.length > 100_000) throw new Error("Invalid job description.");
    const verifiedFacts = body.verifiedFacts === undefined ? "" : body.verifiedFacts;
    if (typeof verifiedFacts !== "string" || verifiedFacts.length > 20_000) throw new Error("Invalid user-verified facts.");
    const session = await writeTailorSession({ id: body.id, name: body.name, sourceLatex: body.sourceLatex, jobDescription: body.jobDescription, verifiedFacts, result: parseResult(body.result), opportunity: parseOpportunity(body.opportunity) });
    const stored = await readTailorSession(session.id);
    return NextResponse.json({ ok: true, ...session, pdfAvailable: false, variants: stored.variants });
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not save the local tailoring session." }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Choose an application variant first.");
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Invalid tailored PDF.");
    const session = await writeTailorPdf(bytes, id);
    return NextResponse.json({ ok: true, id: session.id, branch: session.branch, pdfAvailable: true });
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not save the tailored PDF." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (body.action === "activate") {
      const stored = await activateTailorSession(body.id);
      return NextResponse.json({ ok: true, exists: true, ...stored.session, pdfAvailable: stored.pdfAvailable, variants: stored.variants });
    }
    if (body.action === "rename") {
      const session = await renameTailorSession(body.id, body.name);
      const stored = await readTailorSession(session.id);
      return NextResponse.json({ ok: true, exists: true, ...session, pdfAvailable: stored.pdfAvailable, variants: stored.variants });
    }
    if (body.action === "link") {
      const opportunity = parseOpportunity(body.opportunity);
      if (!opportunity) throw new Error("Choose a Searchboard lead to link.");
      const session = await linkTailorSession(body.id, opportunity);
      const stored = await readTailorSession(session.id);
      return NextResponse.json({ ok: true, exists: true, ...session, pdfAvailable: stored.pdfAvailable, variants: stored.variants });
    }
    throw new Error("Unknown variant action.");
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not update the application variant." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Choose an application variant first.");
    const deleted = await deleteTailorSession(id);
    return NextResponse.json({ ok: true, ...deleted });
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not discard the local tailoring session." }, { status: 500 });
  }
}
