import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { extensionOptions, extensionOriginAllowed, extensionRequestAllowed, extensionResponseHeaders } from "../../../../lib/extension-access";
import { getProjectState, safeProjectPath } from "../../../../lib/project";

export const runtime = "nodejs";
export const maxDuration = 120;

const PDF_PATH = join(/* turbopackIgnore: true */ process.cwd(), "data", "extension-base-resume.pdf");
function cleanLabel(value: unknown, fallback: string, maxLength = 100) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, maxLength);
}

function filenamePart(value: string, fallback: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || fallback;
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

export function OPTIONS(request: Request) {
  return extensionOptions(request);
}

export async function GET(request: Request) {
  const corsHeaders = extensionResponseHeaders(request);
  try {
    if (!extensionOriginAllowed(request)) return NextResponse.json({ error: "Request not allowed." }, { status: 403, headers: corsHeaders });
    const pdf = await readFile(PDF_PATH);
    return new Response(pdf, { headers: { ...corsHeaders, "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=resume.pdf" } });
  } catch {
    return NextResponse.json({ error: "Build the base résumé first." }, { status: 404, headers: corsHeaders });
  }
}

export async function POST(request: Request) {
  const corsHeaders = extensionResponseHeaders(request);
  try {
    if (!extensionRequestAllowed(request, "base-resume")) return NextResponse.json({ error: "Request not allowed." }, { status: 403, headers: corsHeaders });
    const body = await request.json();
    const company = cleanLabel(body.company, "Company");
    const role = cleanLabel(body.role, "Role");
    const candidateName = cleanLabel(body.candidateName, "Resume", 80);
    const project = await getProjectState();
    if (!project.exists) return NextResponse.json({ error: "Import your main résumé project in RoleFit Studio first." }, { status: 404, headers: corsHeaders });
    const sourceLatex = await readFile(safeProjectPath(project.directory, project.mainFile), "utf8");
    const origin = new URL(request.url).origin;
    const compiled = await fetch(`${origin}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latex: sourceLatex }),
      cache: "no-store",
    });
    if (!compiled.ok) throw new Error(await responseError(compiled, "RoleFit could not compile the base résumé."));
    await mkdir(join(/* turbopackIgnore: true */ process.cwd(), "data"), { recursive: true });
    await writeFile(PDF_PATH, Buffer.from(await compiled.arrayBuffer()));
    const date = new Date().toISOString().slice(0, 10);
    const filename = [candidateName, company, role, "Base", date].map((value, index) => filenamePart(value, index ? "Role" : "Resume")).join("_") + ".pdf";
    return NextResponse.json({
      filename,
      mode: "base",
      downloadUrl: `${origin}/api/extension/resume?v=${Date.now()}`,
      roleFitUrl: origin,
    }, { headers: corsHeaders });
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not build the base résumé." }, { status: 500, headers: corsHeaders });
  }
}
