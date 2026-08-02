import { NextResponse } from "next/server";
import { extensionOriginAllowed, extensionResponseHeaders } from "../../../../../lib/extension-access";
import { readTailorPdf } from "../../../../../lib/tailor-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const corsHeaders = extensionResponseHeaders(request);
  try {
    if (!extensionOriginAllowed(request)) return NextResponse.json({ error: "Request not allowed." }, { status: 403, headers: corsHeaders });
    const id = new URL(request.url).searchParams.get("id");
    const pdf = await readTailorPdf(id);
    return new Response(pdf, { headers: { ...corsHeaders, "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=tailored-resume.pdf" } });
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ error: "No saved tailored PDF." }, { status: 404, headers: corsHeaders });
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not restore the tailored PDF." }, { status: 500, headers: corsHeaders });
  }
}
