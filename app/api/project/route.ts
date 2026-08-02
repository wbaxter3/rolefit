import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { NextResponse } from "next/server";
import { ensureGit, ensureProject, getProjectState, isTextFile, listProjectFiles, readProjectText, safeProjectPath } from "../../../lib/project";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const project = await getProjectState();
    if (!project.exists) return NextResponse.json({ ...project, files: [] });
    const requested = new URL(request.url).searchParams.get("file");
    if (requested) return NextResponse.json({ path: requested, content: await readProjectText(project.directory, requested) });
    return NextResponse.json({ ...project, files: await listProjectFiles(project.directory, project.mainFile) });
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not read the resume project." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = await ensureProject();
    await ensureGit(project.directory);

    if (body.action === "save") {
      if (typeof body.path !== "string" || !isTextFile(body.path)) throw new Error("Choose an editable project source file.");
      if (typeof body.content !== "string" || body.content.length > 1_000_000) throw new Error("Source files must be text and under 1 MB.");
      const target = safeProjectPath(project.directory, body.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body.content, "utf8");
      if (/\.tex$/i.test(body.path)) {
        try { await access(resolve(project.directory, project.mainFile)); }
        catch { await writeFile(resolve(project.directory, ".rolefit.json"), JSON.stringify({ mainFile: body.path }, null, 2), "utf8"); }
      }
    } else if (body.action === "upload") {
      if (!Array.isArray(body.files) || body.files.length === 0 || body.files.length > 100) throw new Error("Choose between 1 and 100 project files.");
      let total = 0;
      for (const file of body.files) {
        if (typeof file.path !== "string" || typeof file.content !== "string") throw new Error("Invalid uploaded file.");
        const buffer = file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
        total += buffer.length;
        if (total > 20_000_000) throw new Error("Project uploads are limited to 20 MB.");
        const target = safeProjectPath(project.directory, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, buffer);
      }
      try { await access(resolve(project.directory, project.mainFile)); }
      catch {
        const firstTex = body.files.find((file: { path?: string }) => typeof file.path === "string" && /\.tex$/i.test(file.path));
        if (firstTex?.path) await writeFile(resolve(project.directory, ".rolefit.json"), JSON.stringify({ mainFile: firstTex.path }, null, 2), "utf8");
      }
    } else if (body.action === "delete") {
      if (typeof body.path !== "string") throw new Error("Choose a file to delete.");
      await rm(safeProjectPath(project.directory, body.path), { force: true });
    } else {
      throw new Error("Unknown project action.");
    }

    const updated = await getProjectState();
    return NextResponse.json({ ok: true, ...updated, files: await listProjectFiles(updated.directory, updated.mainFile) });
  } catch (reason) {
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not update the resume project." }, { status: 400 });
  }
}
