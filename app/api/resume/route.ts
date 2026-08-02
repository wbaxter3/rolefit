import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { validateLatex } from "../../../lib/latex";
import { getProjectState } from "../../../lib/project";

export const runtime = "nodejs";

export async function GET() {
  try {
    const project = await getProjectState();
    if (!project.exists) throw Object.assign(new Error("No resume project exists yet."), { code: "ENOENT" });
    const latex = await readFile(resolve(project.directory, project.mainFile), "utf8");
    validateLatex(latex);
    return NextResponse.json({ latex, source: `Project · ${project.mainFile}` });
  } catch (reason) {
    const message = reason instanceof Error && "code" in reason && reason.code === "ENOENT"
      ? "No local resume project exists yet. Import a .tex file in Studio."
      : reason instanceof Error ? reason.message : "Could not load the local resume.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
