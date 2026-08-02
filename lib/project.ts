import { access, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

export const LOCAL_PROJECT_DIR = resolve(/* turbopackIgnore: true */ process.cwd(), "data", "resume-project");
export const MAIN_TEX = process.env.RESUME_MAIN_TEX || "resume.tex";

export type ProjectFile = { path: string; size: number; kind: "tex" | "source" | "image" | "other" };

async function exists(path: string) {
  try { await access(path, constants.R_OK); return true; } catch { return false; }
}

export async function getProjectState() {
  const local = await exists(LOCAL_PROJECT_DIR);
  let mainFile = MAIN_TEX;
  if (local) {
    try {
      const config = JSON.parse(await readFile(resolve(LOCAL_PROJECT_DIR, ".rolefit.json"), "utf8"));
      if (typeof config.mainFile === "string") {
        safeProjectPath(LOCAL_PROJECT_DIR, config.mainFile);
        mainFile = config.mainFile;
      }
    } catch { /* use the configured default */ }
  }
  return {
    exists: local,
    directory: LOCAL_PROJECT_DIR,
    source: "local" as const,
    mainFile,
  };
}

export async function ensureProject() {
  const project = await getProjectState();
  await mkdir(project.directory, { recursive: true });
  return { ...project, exists: true };
}

export function safeProjectPath(directory: string, requested: string) {
  if (!requested || requested.includes("\0") || requested.split(/[\\/]/).some((part) => !part || part === "." || part === ".." || part === ".git")) {
    throw new Error("Invalid project file path.");
  }
  const target = resolve(directory, requested);
  const rel = relative(directory, target);
  if (!rel || rel.startsWith("..") || rel.includes(`${sep}..${sep}`)) throw new Error("Project files must stay inside the resume project.");
  return target;
}

export function isTextFile(path: string) {
  return /\.(tex|text|sty|cls|bib|bst|txt|md|yaml|yml|json|csv)$/i.test(path);
}

function kindFor(path: string): ProjectFile["kind"] {
  if (/\.tex$/i.test(path)) return "tex";
  if (/\.(text|sty|cls|bib|bst|txt|md|yaml|yml|json|csv)$/i.test(path)) return "source";
  if (/\.(png|jpe?g|gif|webp|pdf|eps)$/i.test(path)) return "image";
  return "other";
}

export async function listProjectFiles(directory: string, mainFile = MAIN_TEX) {
  const files: ProjectFile[] = [];
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const info = await stat(absolute);
        files.push({ path: relative(directory, absolute).split(sep).join("/"), size: info.size, kind: kindFor(entry.name) });
      }
    }
  }
  if (await exists(directory)) await walk(directory);
  return files.sort((a, b) => (a.path === mainFile ? -1 : b.path === mainFile ? 1 : a.path.localeCompare(b.path)));
}

export async function readProjectText(directory: string, path: string) {
  if (!isTextFile(path)) throw new Error("That file is not editable as text.");
  return readFile(safeProjectPath(directory, path), "utf8");
}

export function runCommand(command: string, args: string[], cwd: string, timeout = 30_000) {
  return new Promise<string>((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let output = "";
    const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-100_000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} timed out.`)); }, timeout);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun(output.trim());
      else reject(Object.assign(new Error(output.trim() || `${command} exited with code ${code}.`), { code }));
    });
  });
}

export async function ensureGit(directory: string) {
  if (await exists(resolve(directory, ".git"))) return;
  await runCommand("git", ["init", "-b", "main"], directory);
}

export async function git(directory: string, args: string[]) {
  return runCommand("git", args, directory);
}
