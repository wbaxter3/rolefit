import { createWriteStream } from "node:fs";
import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { fromBufferPromise, type Entry } from "yauzl";
import { ensureGit, ensureProject, getProjectState, listProjectFiles, safeProjectPath } from "../../../../lib/project";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ARCHIVE_BYTES = 25_000_000;
const MAX_EXTRACTED_BYTES = 60_000_000;
const MAX_FILE_BYTES = 20_000_000;
const MAX_FILES = 500;
const MAX_EXPANSION_RATIO = 250;

type ScannedEntry = { name: string; size: number };

function normalizedName(entry: Entry) {
  const name = entry.fileName.replaceAll("\\", "/");
  if (!name || name.includes("\0") || name.startsWith("/") || /^[A-Za-z]:\//.test(name)) throw new Error("The ZIP contains an unsafe absolute file path.");
  const parts = name.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part === ".git")) throw new Error("The ZIP contains an unsafe path or embedded Git repository.");
  return parts.join("/") + (name.endsWith("/") ? "/" : "");
}

function ignored(name: string) {
  return name.startsWith("__MACOSX/") || name.endsWith("/.DS_Store") || name === ".DS_Store" || name.endsWith("/.rolefit.json") || name === ".rolefit.json";
}

function assertSafeEntry(entry: Entry) {
  if (entry.isEncrypted()) throw new Error("Encrypted ZIP files are not supported.");
  if (!entry.canDecodeFileData()) throw new Error(`Unsupported ZIP compression for ${entry.fileName}.`);
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  if ((mode & 0o170000) === 0o120000) throw new Error("Symbolic links are not allowed in resume ZIP files.");
  if (entry.uncompressedSize > MAX_FILE_BYTES) throw new Error(`A ZIP entry exceeds the 20 MB per-file limit: ${entry.fileName}`);
  if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_EXPANSION_RATIO) throw new Error(`A ZIP entry expands too aggressively: ${entry.fileName}`);
}

async function scanArchive(buffer: Buffer) {
  const zip = await fromBufferPromise(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  const entries: ScannedEntry[] = [];
  let total = 0;
  for await (const entry of zip.eachEntry()) {
    assertSafeEntry(entry);
    const name = normalizedName(entry);
    if (name.endsWith("/") || ignored(name)) continue;
    entries.push({ name, size: entry.uncompressedSize });
    total += entry.uncompressedSize;
    if (entries.length > MAX_FILES) throw new Error("ZIP projects are limited to 500 files.");
    if (total > MAX_EXTRACTED_BYTES) throw new Error("The extracted ZIP project exceeds 60 MB.");
  }
  if (!entries.length) throw new Error("The ZIP does not contain any project files.");
  if (!entries.some((entry) => entry.name.toLowerCase().endsWith(".tex"))) throw new Error("The ZIP must contain at least one .tex file.");
  return { entries, total };
}

function commonRoot(entries: ScannedEntry[]) {
  const first = entries[0].name.split("/")[0];
  return entries.every((entry) => entry.name.startsWith(`${first}/`)) ? `${first}/` : "";
}

function chooseMainFile(files: Awaited<ReturnType<typeof listProjectFiles>>) {
  const tex = files.filter((file) => file.kind === "tex");
  const preferred = ["resume.tex", "main.tex", "cv.tex"];
  for (const name of preferred) {
    const rootMatch = tex.find((file) => file.path.toLowerCase() === name);
    if (rootMatch) return rootMatch;
  }
  const root = tex.find((file) => !file.path.includes("/"));
  if (root) return root;
  for (const name of preferred) {
    const nestedMatch = tex.find((file) => file.path.toLowerCase().endsWith(`/${name}`));
    if (nestedMatch) return nestedMatch;
  }
  return tex[0];
}

async function extractArchive(buffer: Buffer, destination: string, prefix: string) {
  const zip = await fromBufferPromise(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  for await (const entry of zip.eachEntry()) {
    assertSafeEntry(entry);
    const original = normalizedName(entry);
    if (original.endsWith("/") || ignored(original)) continue;
    const relative = prefix && original.startsWith(prefix) ? original.slice(prefix.length) : original;
    const target = safeProjectPath(destination, relative);
    await mkdir(dirname(target), { recursive: true });
    const stream = await zip.openReadStreamPromise(entry);
    await pipeline(stream, createWriteStream(target, { flags: "w", mode: 0o600 }));
  }
}

export async function POST(request: Request) {
  let temporary = "";
  try {
    const form = await request.formData();
    const upload = form.get("file");
    if (!(upload instanceof File) || !upload.name.toLowerCase().endsWith(".zip")) throw new Error("Choose one .zip resume project.");
    if (upload.size === 0 || upload.size > MAX_ARCHIVE_BYTES) throw new Error("ZIP files must be between 1 byte and 25 MB.");

    const buffer = Buffer.from(await upload.arrayBuffer());
    const scan = await scanArchive(buffer);
    const prefix = commonRoot(scan.entries);
    temporary = await mkdtemp(resolve(tmpdir(), "rolefit-zip-"));
    await extractArchive(buffer, temporary, prefix);

    const project = await ensureProject();
    await ensureGit(project.directory);
    await cp(temporary, project.directory, { recursive: true, force: true });

    const imported = await listProjectFiles(temporary);
    try { await access(resolve(project.directory, project.mainFile)); }
    catch {
      const main = chooseMainFile(imported);
      if (main) await writeFile(resolve(project.directory, ".rolefit.json"), JSON.stringify({ mainFile: main.path }, null, 2), "utf8");
    }

    const updated = await getProjectState();
    return NextResponse.json({
      ok: true,
      ...updated,
      files: await listProjectFiles(updated.directory, updated.mainFile),
      imported: imported.length,
      extractedBytes: scan.total,
    });
  } catch (reason) {
    console.error("ZIP import failed:", reason);
    return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not import the ZIP project." }, { status: 400 });
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
  }
}
