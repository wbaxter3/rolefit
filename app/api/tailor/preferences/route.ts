import { NextResponse } from "next/server";
import { appendTailoringFeedback, readTailoringPreferences, writeTailoringPreferences } from "../../../../lib/tailoring-preferences";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    return NextResponse.json(await readTailoringPreferences(), { headers });
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not load tailoring preferences." }, { status: 500, headers });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json(await writeTailoringPreferences(body.rules), { headers });
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not save tailoring preferences." }, { status: 400, headers });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json(await appendTailoringFeedback(body.feedback), { headers });
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not remember that feedback." }, { status: 400, headers });
  }
}
