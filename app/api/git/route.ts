import { NextResponse } from "next/server";
import { ensureGit, getProjectState, git } from "../../../lib/project";

export const runtime = "nodejs";

type GitError = Error & { code?: number };

async function optional(directory: string, args: string[], fallback = "") {
  try { return await git(directory, args); } catch { return fallback; }
}

async function snapshot() {
  const project = await getProjectState();
  if (!project.exists) return { exists: false, branch: "main", branches: [], changes: [], history: [], diff: "", remote: null, ahead: 0, behind: 0 };
  await ensureGit(project.directory);
  const [branch, branchList, porcelain, historyText, diff, remote, tracking] = await Promise.all([
    optional(project.directory, ["branch", "--show-current"], "main"),
    optional(project.directory, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]),
    optional(project.directory, ["status", "--porcelain=v1"]),
    optional(project.directory, ["log", "-30", "--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s"]),
    optional(project.directory, ["diff", "--no-ext-diff", "--unified=3", "HEAD", "--"]),
    optional(project.directory, ["remote", "get-url", "origin"]),
    optional(project.directory, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
  ]);
  const [behind = 0, ahead = 0] = tracking.split(/\s+/).map(Number);
  return {
    exists: true,
    source: project.source,
    branch: branch || "main",
    branches: branchList.split("\n").filter(Boolean),
    changes: porcelain.split("\n").filter(Boolean).map((line) => ({ status: line.slice(0, 2).trim() || "?", path: line.slice(3) })),
    history: historyText.split("\n").filter(Boolean).map((line) => { const [sha, short, author, relative, subject] = line.split("\x1f"); return { sha, short, author, relative, subject }; }),
    diff,
    remote: remote || null,
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
  };
}

export async function GET() {
  try { return NextResponse.json(await snapshot()); }
  catch (reason) { return NextResponse.json({ error: reason instanceof Error ? reason.message : "Could not read Git state." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = await getProjectState();
    if (!project.exists) throw new Error("Create or import a resume project first.");
    await ensureGit(project.directory);
    const current = (await optional(project.directory, ["branch", "--show-current"], "main")) || "main";

    if (body.action === "commit") {
      if (typeof body.message !== "string" || body.message.trim().length < 3 || body.message.length > 120) throw new Error("Write a commit message between 3 and 120 characters.");
      await git(project.directory, ["add", "-A"]);
      if (!(await optional(project.directory, ["status", "--porcelain"]))) throw new Error("There are no changes to commit.");
      await git(project.directory, ["commit", "-m", body.message.trim()]);
    } else if (body.action === "branch") {
      if (typeof body.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(body.name)) throw new Error("Use a short branch name with letters, numbers, dots, dashes, or slashes.");
      await git(project.directory, ["check-ref-format", "--branch", body.name]);
      await git(project.directory, ["switch", "-c", body.name]);
    } else if (body.action === "switch") {
      if (typeof body.name !== "string") throw new Error("Choose a branch.");
      const dirty = await optional(project.directory, ["status", "--porcelain"]);
      if (dirty) throw new Error("Commit your current changes before switching branches.");
      await git(project.directory, ["switch", body.name]);
    } else if (body.action === "pull" || body.action === "push") {
      const remotes = (await optional(project.directory, ["remote"])).split("\n").filter(Boolean);
      const remote = remotes.includes("origin") ? "origin" : null;
      if (!remote) throw new Error("No Git remote is connected. Local commits and branches still work without one.");
      const remoteBranch = current;
      if (body.action === "pull") {
        if (await optional(project.directory, ["status", "--porcelain"])) throw new Error("Commit your changes before pulling.");
        await git(project.directory, ["pull", "--ff-only", remote, remoteBranch]);
      } else {
        await git(project.directory, ["push", "-u", remote, `${current}:${remoteBranch}`]);
      }
    } else {
      throw new Error("Unknown Git action.");
    }
    return NextResponse.json({ ok: true, ...(await snapshot()) });
  } catch (reason) {
    const error = reason as GitError;
    return NextResponse.json({ error: error.message || "Git operation failed." }, { status: 400 });
  }
}
