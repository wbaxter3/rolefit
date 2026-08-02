import { NextResponse } from "next/server";
import { findCompiler } from "../../../lib/latex";
import { getProjectState } from "../../../lib/project";

export const runtime = "nodejs";

export async function GET() {
  const compiler = await findCompiler();
  const project = await getProjectState();
  return NextResponse.json({
    apiKey: Boolean(process.env.OPENAI_API_KEY),
    compiler: compiler?.name || null,
    project: project.exists,
    model: process.env.OPENAI_MODEL || "gpt-5.6-sol",
  });
}
