import { NextResponse } from "next/server";
import { extensionOptions, extensionRequestAllowed, extensionResponseHeaders } from "../../../../lib/extension-access";
import { readTailorSession, type TailorVariantSummary } from "../../../../lib/tailor-session";

export const runtime = "nodejs";

function response(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: extensionResponseHeaders(request) });
}

function clean(value: unknown, maximum = 300) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalize(value: string, company = false) {
  let result = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (company) result = result.replace(/\b(?:incorporated|corporation|company|limited|inc|corp|co|llc|ltd)\b/g, " ").replace(/\s+/g, " ").trim();
  return result;
}

function closeMatch(left: string, right: string, company = false) {
  const a = normalize(left, company);
  const b = normalize(right, company);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a));
}

function variantIdentity(variant: TailorVariantSummary) {
  if (variant.opportunity) return { company: variant.opportunity.company, role: variant.opportunity.role };
  const [company = "", role = ""] = variant.name.split(/\s+[—–]\s+/, 2);
  return { company: company.trim(), role: role.trim() };
}

function safeFilename(candidateName: string, company: string) {
  const base = [candidateName || "Candidate", company, "Resume"]
    .filter(Boolean)
    .join("_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 180);
  return `${base || "Tailored_Resume"}.pdf`;
}

export function OPTIONS(request: Request) {
  return extensionOptions(request);
}

export async function POST(request: Request) {
  try {
    if (!extensionRequestAllowed(request, "variant-status")) return response(request, { error: "Invalid extension request." }, 403);
    const body = await request.json();
    const company = clean(body.company, 200);
    const role = clean(body.role, 300);
    const candidateName = clean(body.candidateName, 200);
    if (!company || !role) return response(request, { match: null });

    const stored = await readTailorSession();
    const summary = stored.variants.find((variant) => {
      if (!variant.pdfAvailable) return false;
      const identity = variantIdentity(variant);
      return closeMatch(company, identity.company, true) && closeMatch(role, identity.role);
    });
    if (!summary) return response(request, { match: null, variantsCount: stored.variants.length });

    const matched = await readTailorSession(summary.id);
    if (!matched.session || !matched.pdfAvailable) return response(request, { match: null, variantsCount: stored.variants.length });
    const identity = variantIdentity(summary);
    const origin = new URL(request.url).origin;
    return response(request, {
      match: {
        id: matched.session.id,
        name: matched.session.name,
        company: identity.company || company,
        role: identity.role || role,
        updatedAt: matched.session.updatedAt,
        filename: safeFilename(candidateName, identity.company || company),
        downloadUrl: `${origin}/api/tailor/session/pdf?id=${encodeURIComponent(matched.session.id)}`,
        jobDescription: matched.session.jobDescription,
      },
      variantsCount: stored.variants.length,
    });
  } catch (reason) {
    return response(request, { error: reason instanceof Error ? reason.message : "Could not inspect saved application variants." }, 500);
  }
}
