import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, parse, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { findCompiler, validateLatex } from "../../../lib/latex";
import { getProjectState } from "../../../lib/project";

export const runtime = "nodejs";
export const maxDuration = 120;

function run(command: string, args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, SOURCE_DATE_EPOCH: "0" } });
    let output = "";
    const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-12_000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("PDF compilation timed out after 90 seconds.")); }, 90_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`LaTeX could not compile.\n\n${output.slice(-4_000)}`));
    });
  });
}

export async function POST(request: Request) {
  let directory = "";
  try {
    const body = await request.json();
    validateLatex(body.latex);
    const compiler = await findCompiler();
    if (!compiler) return NextResponse.json({ error: "No LaTeX compiler found. Install Tectonic with: brew install tectonic" }, { status: 503 });

    directory = await mkdtemp(join(tmpdir(), "rolefit-"));
    const project = await getProjectState();
    let sourceName = "resume.tex";
    if (project.exists) {
      await cp(project.directory, directory, { recursive: true, filter: (source) => basename(source) !== ".git" });
      sourceName = project.mainFile;
      if (relative(directory, resolve(directory, sourceName)).startsWith("..")) throw new Error("Invalid RESUME_MAIN_TEX path.");
    }
    const sourcePath = resolve(directory, sourceName);
    await writeFile(sourcePath, body.latex, "utf8");
    if (compiler.name === "tectonic") await run(compiler.path, ["--untrusted", "--keep-logs", "--outdir", directory, sourcePath], directory);
    else await run(compiler.path, ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "-output-directory", directory, sourcePath], directory);
    const pdf = await readFile(join(directory, `${parse(sourceName).name}.pdf`));
    return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=tailored-resume.pdf", "Cache-Control": "no-store" } });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Could not compile the PDF.";
    console.error("Compilation failed:", reason);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
