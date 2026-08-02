"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { LatexCodeEditor } from "./latex-code-editor";
import studioAi from "./studio-ai.module.css";
import tailorFollowUp from "./tailor-followup.module.css";
import applicationSwitcher from "./application-switcher.module.css";

type TailorResult = { tailored_latex: string; changes: string[]; matched_keywords: string[]; warnings: string[] };
type StudioProposal = { fileName: string; edited_content: string; summary: string[]; commit_message: string; warnings: string[] };
type OpportunityLink = { id: string; company: string; role: string };
type TailorVariant = { id: string; name: string; branch: string; createdAt: string; updatedAt: string; pdfAvailable: boolean; opportunity?: OpportunityLink };
type TailorSession = { exists: boolean; id?: string; name?: string; branch: string; sourceLatex?: string; jobDescription?: string; verifiedFacts?: string; result?: TailorResult; updatedAt?: string; pdfAvailable?: boolean; variants?: TailorVariant[]; opportunity?: OpportunityLink };
type SearchboardOpportunity = OpportunityLink & { stage: string; source: string; location?: string; compensation?: string; techStack?: string[]; lastActivity: string; action?: string; summary: string; emailUrl?: string; jobContext: string; variant: TailorVariant | null };
type SearchboardState = { connected: boolean; sourcePath?: string; opportunities: SearchboardOpportunity[]; error?: string };
type Health = { apiKey: boolean; compiler: string | null; project: boolean; model: string };
type ProjectFile = { path: string; size: number; kind: "tex" | "source" | "image" | "other" };
export type ProjectState = { exists: boolean; source: "local"; mainFile: string; files: ProjectFile[] };
type GitState = {
  exists: boolean; source?: "local"; branch: string; branches: string[];
  changes: { status: string; path: string }[]; history: { sha: string; short: string; author: string; relative: string; subject: string }[];
  diff: string; remote: string | null; ahead: number; behind: number;
};

const STORAGE_KEY = "rolefit:master-resume";

function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/x-tex" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

function filenamePart(value: string, fallback: string) {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return cleaned || fallback;
}

async function getError(response: Response) {
  const payload = await response.json().catch(() => null);
  return payload?.error || `Request failed (${response.status})`;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function RoleFitClient({ initialProject, initialResume }: { initialProject: ProjectState; initialResume: string }) {
  const [view, setView] = useState<"studio" | "tailor">("studio");
  const [resume, setResume] = useState(initialResume);
  const [jobDescription, setJobDescription] = useState("");
  const [verifiedFacts, setVerifiedFacts] = useState("");
  const [tailoringPreferences, setTailoringPreferences] = useState("");
  const [savedTailoringPreferences, setSavedTailoringPreferences] = useState("");
  const [result, setResult] = useState<TailorResult | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfKind, setPdfKind] = useState<"master" | "tailored" | null>(null);
  const [sessionUpdatedAt, setSessionUpdatedAt] = useState("");
  const [sessionBranch, setSessionBranch] = useState("");
  const [tailorSource, setTailorSource] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [variants, setVariants] = useState<TailorVariant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState("");
  const [activeVariantName, setActiveVariantName] = useState("");
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [project, setProject] = useState<ProjectState>(initialProject);
  const [gitState, setGitState] = useState<GitState | null>(null);
  const [activeFile, setActiveFile] = useState(initialProject.exists ? initialProject.mainFile : "");
  const [editor, setEditor] = useState(initialResume);
  const [savedEditor, setSavedEditor] = useState(initialResume);
  const [commitMessage, setCommitMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [showBranch, setShowBranch] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiProposal, setAiProposal] = useState<StudioProposal | null>(null);
  const [linkedOpportunity, setLinkedOpportunity] = useState<OpportunityLink | null>(null);
  const [searchboard, setSearchboard] = useState<SearchboardState | null>(null);
  const [linkOpportunityId, setLinkOpportunityId] = useState("");

  const editorDirty = editor !== savedEditor;
  const ready = resume.trim().length > 0 && jobDescription.trim().length > 80;
  const wordCount = useMemo(() => jobDescription.trim().split(/\s+/).filter(Boolean).length, [jobDescription]);
  const tailoringPreferenceCount = useMemo(() => tailoringPreferences.split("\n").map((rule) => rule.trim()).filter(Boolean).length, [tailoringPreferences]);
  const linkableOpportunities = useMemo(() => searchboard?.opportunities.filter((opportunity) => !opportunity.variant || opportunity.variant.id === activeVariantId) || [], [activeVariantId, searchboard]);
  const tailoredDownloadName = useMemo(() => {
    const applicationName = linkedOpportunity
      ? linkedOpportunity.company
      : activeVariantName.split(/\s+[—–-]\s+/, 1)[0] || "Tailored";
    return `Candidate_${filenamePart(applicationName, "Tailored")}_Resume`;
  }, [activeVariantName, linkedOpportunity]);

  useEffect(() => {
    const savedResume = window.localStorage.getItem(STORAGE_KEY);
    let cancelled = false;
    if (!initialProject.exists && savedResume) queueMicrotask(() => { if (!cancelled) setResume(savedResume); });
    void Promise.all([refreshHealth(), refreshProject(), refreshGit(), refreshTailorSession(), refreshSearchboard(), refreshTailoringPreferences()]).then(([, , , , board]) => {
      const opportunityId = new URLSearchParams(window.location.search).get("opportunity");
      const opportunity = opportunityId ? board?.opportunities.find((item) => item.id === opportunityId) : null;
      if (opportunity) void openOpportunity(opportunity);
    });
    // This is the one-time workspace bootstrap; subsequent refreshes are action-driven.
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  useEffect(() => {
    if (!result || sessionUpdatedAt || jobDescription.trim().length < 80) return;
    const timer = window.setTimeout(() => {
      void persistTailorResult(result).then(async (session) => {
        if (pdfUrl && pdfKind === "tailored" && session.id) await persistTailorPdf(await fetch(pdfUrl).then((response) => response.blob()), session.id);
      }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
    // Capture a pre-existing in-memory result after Fast Refresh adds local persistence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, sessionUpdatedAt, jobDescription, pdfUrl, pdfKind]);

  async function refreshHealth() {
    const response = await fetch("/api/health");
    if (response.ok) setHealth(await response.json());
  }

  async function refreshSearchboard() {
    const response = await fetch("/api/searchboard");
    const data = await response.json().catch(() => ({ connected: false, opportunities: [], error: "Could not read Searchboard." })) as SearchboardState;
    setSearchboard(data);
    return data;
  }

  async function refreshTailoringPreferences() {
    const response = await fetch("/api/tailor/preferences", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { rules?: string[] };
    const text = (data.rules || []).join("\n");
    setTailoringPreferences(text);
    setSavedTailoringPreferences(text);
  }

  async function persistTailoringPreferences() {
    const rules = tailoringPreferences.split("\n").map((rule) => rule.trim()).filter(Boolean);
    const response = await fetch("/api/tailor/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }) });
    if (!response.ok) throw new Error(await getError(response));
    const data = await response.json() as { rules: string[] };
    const text = data.rules.join("\n");
    setTailoringPreferences(text);
    setSavedTailoringPreferences(text);
    return data;
  }

  async function saveTailoringPreferences() {
    setBusy(true); setError(""); setStatus("Saving tailoring preferences…");
    try { await persistTailoringPreferences(); setStatus("Tailoring preferences saved · future leads will use them"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save tailoring preferences."); setStatus("Ready"); }
    finally { setBusy(false); }
  }

  async function rememberTailoringFeedback(feedback: string) {
    const response = await fetch("/api/tailor/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedback }) });
    if (!response.ok) throw new Error(await getError(response));
    const data = await response.json() as { rules: string[] };
    const text = data.rules.join("\n");
    setTailoringPreferences(text);
    setSavedTailoringPreferences(text);
  }

  async function refreshProject(preferred?: string) {
    const response = await fetch("/api/project");
    if (!response.ok) return;
    const data: ProjectState = await response.json();
    setProject(data);
    if (data.exists && data.files.length) {
      const candidate = preferred || activeFile || (data.files.some((file) => file.path === data.mainFile) ? data.mainFile : data.files.find((file) => file.kind === "tex" || file.kind === "source")?.path);
      if (candidate) await loadFile(candidate, data);
    }
  }

  async function refreshGit() {
    const response = await fetch("/api/git");
    if (!response.ok) return null;
    const data: GitState = await response.json();
    setGitState(data);
    return data;
  }

  function setPdf(blob: Blob, kind: "master" | "tailored") {
    const url = URL.createObjectURL(blob);
    setPdfUrl((current) => { if (current) URL.revokeObjectURL(current); return url; });
    setPdfKind(kind);
    return { blob, url };
  }

  async function refreshTailorSession(clearWhenMissing = false, id?: string | null) {
    const response = await fetch(`/api/tailor/session${id ? `?id=${encodeURIComponent(id)}` : ""}`);
    if (!response.ok) return;
    const session: TailorSession = await response.json();
    setVariants(session.variants || []);
    if (!session.exists || !session.result || !session.jobDescription) {
      if (clearWhenMissing) {
        setResult(null); setJobDescription(""); setVerifiedFacts(""); setSessionUpdatedAt(""); setSessionBranch(""); setTailorSource(""); setFollowUp(""); setActiveVariantId(""); setActiveVariantName(""); setLinkedOpportunity(null);
        if (pdfKind === "tailored") { setPdfUrl((current) => { if (current) URL.revokeObjectURL(current); return null; }); setPdfKind(null); }
      }
      return;
    }
    setJobDescription(session.jobDescription);
    setVerifiedFacts(session.verifiedFacts || "");
    setResult(session.result);
    setTailorSource(session.sourceLatex || resume);
    setSessionUpdatedAt(session.updatedAt || "");
    setSessionBranch(session.branch);
    setActiveVariantId(session.id || "");
    setActiveVariantName(session.name || "Untitled application");
    setLinkedOpportunity(session.opportunity || null);
    if (session.pdfAvailable) {
      const pdfResponse = await fetch(`/api/tailor/session/pdf?id=${encodeURIComponent(session.id || "")}&v=${encodeURIComponent(session.updatedAt || "latest")}`);
      if (pdfResponse.ok) setPdf(await pdfResponse.blob(), "tailored");
    } else if (pdfKind === "tailored") {
      setPdfUrl((current) => { if (current) URL.revokeObjectURL(current); return null; }); setPdfKind(null);
    }
    setStatus("Restored local tailoring draft");
  }

  async function persistTailorResult(next: TailorResult) {
    const response = await fetch("/api/tailor/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: activeVariantId || undefined, name: activeVariantName || undefined, sourceLatex: tailorSource || resume, jobDescription, verifiedFacts, result: next, opportunity: linkedOpportunity || undefined }) });
    if (!response.ok) throw new Error(await getError(response));
    const session: TailorSession = await response.json();
    setSessionUpdatedAt(session.updatedAt || "");
    setSessionBranch(session.branch);
    setActiveVariantId(session.id || ""); setActiveVariantName(session.name || "Untitled application"); setVariants(session.variants || []);
    void refreshSearchboard();
    return session;
  }

  async function persistTailorPdf(blob: Blob, id = activeVariantId) {
    if (!id) throw new Error("Save the application variant before its PDF.");
    const response = await fetch(`/api/tailor/session?id=${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: blob });
    if (!response.ok) throw new Error(await getError(response));
    void refreshSearchboard();
  }

  async function discardTailorSession() {
    if (!window.confirm("Discard this local tailoring draft and its PDF? Your resume project will not be changed.")) return;
    const response = await fetch(`/api/tailor/session?id=${encodeURIComponent(activeVariantId)}`, { method: "DELETE" });
    if (!response.ok) { setError(await getError(response)); return; }
    const deleted = await response.json();
    await refreshTailorSession(true, deleted.activeId);
    void refreshSearchboard();
    setStatus("Application variant discarded");
  }

  function newVariant() {
    setResult(null); setJobDescription(""); setVerifiedFacts(""); setSessionUpdatedAt(""); setSessionBranch(""); setTailorSource(resume); setFollowUp(""); setActiveVariantId(""); setActiveVariantName(""); setLinkedOpportunity(null);
    if (pdfKind === "tailored") { setPdfUrl((current) => { if (current) URL.revokeObjectURL(current); return null; }); setPdfKind(null); }
    setStatus("New application variant · paste a job description to begin");
  }

  async function selectVariant(id: string) {
    if (!id) { newVariant(); return; }
    setBusy(true); setError(""); setStatus("Switching application variant…");
    try {
      const response = await fetch("/api/tailor/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activate", id }) });
      if (!response.ok) throw new Error(await getError(response));
      await refreshTailorSession(true, id); setStatus("Application variant restored");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not switch application variants."); }
    finally { setBusy(false); }
  }

  async function openOpportunity(opportunity: SearchboardOpportunity) {
    setView("tailor");
    if (opportunity.variant) {
      await selectVariant(opportunity.variant.id);
      return;
    }
    newVariant();
    setLinkedOpportunity({ id: opportunity.id, company: opportunity.company, role: opportunity.role });
    setActiveVariantName(`${opportunity.company} — ${opportunity.role}`.slice(0, 90));
    setJobDescription(opportunity.jobContext);
    setStatus("Searchboard opportunity loaded · add the full description, then tailor");
  }

  async function renameVariant() {
    if (!activeVariantId) return;
    const name = window.prompt("Name this application variant", activeVariantName);
    if (!name || name.trim() === activeVariantName) return;
    const response = await fetch("/api/tailor/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rename", id: activeVariantId, name }) });
    if (!response.ok) { setError(await getError(response)); return; }
    const session: TailorSession = await response.json(); setActiveVariantName(session.name || name.trim()); setVariants(session.variants || []); setStatus("Application variant renamed");
  }

  async function linkCurrentVariant() {
    const opportunity = linkableOpportunities.find((item) => item.id === linkOpportunityId);
    if (!activeVariantId || !opportunity) return;
    setBusy(true); setError(""); setStatus("Linking Searchboard lead…");
    try {
      const response = await fetch("/api/tailor/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link", id: activeVariantId, opportunity: { id: opportunity.id, company: opportunity.company, role: opportunity.role } }),
      });
      if (!response.ok) throw new Error(await getError(response));
      await Promise.all([refreshTailorSession(false, activeVariantId), refreshSearchboard()]);
      setLinkOpportunityId("");
      setStatus(`Linked to ${opportunity.company} · ${opportunity.role}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not link the Searchboard lead.");
      setStatus("Ready");
    } finally {
      setBusy(false);
    }
  }

  async function duplicateVariant() {
    if (!result || !activeVariantId) return;
    setBusy(true); setError(""); setStatus("Duplicating application variant…");
    try {
      const response = await fetch("/api/tailor/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `${activeVariantName} copy`, sourceLatex: tailorSource || resume, jobDescription, verifiedFacts, result }) });
      if (!response.ok) throw new Error(await getError(response));
      const session: TailorSession = await response.json();
      setActiveVariantId(session.id || ""); setActiveVariantName(session.name || `${activeVariantName} copy`); setSessionUpdatedAt(session.updatedAt || ""); setSessionBranch(session.branch); setVariants(session.variants || []);
      if (pdfUrl && pdfKind === "tailored" && session.id) await persistTailorPdf(await fetch(pdfUrl).then((item) => item.blob()), session.id);
      setStatus("Application variant duplicated");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not duplicate the application variant."); }
    finally { setBusy(false); }
  }

  async function loadFile(path: string, currentProject = project) {
    const file = currentProject?.files.find((item) => item.path === path);
    if (file && file.kind !== "tex" && file.kind !== "source") {
      setError("Binary project assets are included when compiling, but are not editable in the text editor.");
      return;
    }
    if (editorDirty && activeFile && !window.confirm("Discard the unsaved editor changes and open another file?")) return;
    const response = await fetch(`/api/project?file=${encodeURIComponent(path)}`);
    if (!response.ok) { setError(await getError(response)); return; }
    const data = await response.json();
    setActiveFile(path); setEditor(data.content); setSavedEditor(data.content); setError("");
    if (path === currentProject?.mainFile) {
      setResume(data.content); window.localStorage.setItem(STORAGE_KEY, data.content);
    }
  }

  async function saveFile(path = activeFile, content = editor) {
    if (!path) return;
    setBusy(true); setStatus(`Saving ${path}…`); setError("");
    try {
      const response = await fetch("/api/project", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", path, content }) });
      if (!response.ok) throw new Error(await getError(response));
      setSavedEditor(content);
      if (path === (project?.mainFile || "resume.tex")) { setResume(content); window.localStorage.setItem(STORAGE_KEY, content); }
      setStatus("Saved to project · reading Git changes…");
      const [, nextGit] = await Promise.all([refreshProject(path), refreshGit(), refreshHealth()]);
      if (nextGit?.changes.length) {
        setStatus("Saved to project · generating commit message…");
        try { await generateCommitMessage(nextGit); setStatus("Saved to project · commit message ready"); }
        catch { setStatus("Saved to project · write a commit message when ready"); }
      } else setStatus("Saved to project");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the file."); }
    finally { setBusy(false); }
  }

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;
    setBusy(true); setStatus("Importing project files…"); setError("");
    try {
      const zipFiles = selected.filter((file) => file.name.toLowerCase().endsWith(".zip"));
      if (zipFiles.length && selected.length !== 1) throw new Error("Import one ZIP at a time, or choose loose project files without a ZIP.");
      let response: Response;
      if (zipFiles.length === 1) {
        const form = new FormData(); form.append("file", zipFiles[0]);
        response = await fetch("/api/project/import", { method: "POST", body: form });
      } else {
        const files = await Promise.all(selected.map(async (file) => {
          const text = /\.(tex|text|sty|cls|bib|bst|txt|md|yaml|yml|json|csv)$/i.test(file.name);
          return { path: file.webkitRelativePath || file.name, content: text ? await file.text() : await fileToBase64(file), encoding: text ? "utf8" : "base64" };
        }));
        response = await fetch("/api/project", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upload", files }) });
      }
      if (!response.ok) throw new Error(await getError(response));
      const next = await response.json();
      setProject(next);
      const main = next.files.some((file: ProjectFile) => file.path === next.mainFile) ? next.mainFile : next.files.find((file: ProjectFile) => file.kind === "tex")?.path;
      const [nextGit] = await Promise.all([refreshGit(), refreshHealth()]);
      if (main) await loadFile(main, next);
      if (nextGit?.changes.length) {
        setStatus("Project imported · generating commit message…");
        try { await generateCommitMessage(nextGit); setStatus("Project imported · commit message ready"); }
        catch { setStatus("Project imported · review and commit when ready"); }
      } else setStatus(`${zipFiles.length ? "ZIP project" : "Project files"} imported · review and commit when ready`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import the project."); }
    finally { setBusy(false); event.target.value = ""; }
  }

  async function startFromSavedResume() {
    if (!resume) return;
    setActiveFile("resume.tex"); setEditor(resume);
    await saveFile("resume.tex", resume);
  }

  async function gitAction(action: string, payload: Record<string, string> = {}) {
    setBusy(true); setError(""); setStatus(`${action[0].toUpperCase()}${action.slice(1)} in progress…`);
    try {
      const response = await fetch("/api/git", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      if (!response.ok) throw new Error(await getError(response));
      const next: GitState = await response.json(); setGitState(next);
      setCommitMessage(""); setBranchName(""); setShowBranch(false); setStatus(`${action[0].toUpperCase()}${action.slice(1)} complete`);
      await refreshProject();
      if (action === "branch" || action === "switch") await refreshTailorSession(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Git operation failed."); setStatus("Ready"); }
    finally { setBusy(false); }
  }

  async function requestStudioEdit() {
    if (!activeFile || !editor || aiPrompt.trim().length < 5) return;
    setBusy(true); setError(""); setStatus("AI is preparing a reviewable edit…");
    try {
      const response = await fetch("/api/studio-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "edit", fileName: activeFile, content: editor, instruction: aiPrompt, isMain: activeFile === project?.mainFile }) });
      if (!response.ok) throw new Error(await getError(response));
      const proposal = await response.json();
      setAiProposal({ ...proposal, fileName: activeFile });
      setStatus("AI proposal ready · nothing has been changed");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare the AI edit."); setStatus("Ready"); }
    finally { setBusy(false); }
  }

  function applyStudioProposal() {
    if (!aiProposal || aiProposal.fileName !== activeFile) return;
    setEditor(aiProposal.edited_content);
    if (activeFile === project?.mainFile) setResume(aiProposal.edited_content);
    setCommitMessage(aiProposal.commit_message);
    setAiPrompt(""); setAiProposal(null); setStatus("AI proposal loaded in the editor · review and save when ready");
  }

  async function generateCommitMessage(state: GitState) {
    const response = await fetch("/api/studio-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit", changes: state.changes, diff: state.diff }) });
    if (!response.ok) throw new Error(await getError(response));
    const suggestion = await response.json();
    setCommitMessage(suggestion.commit_message);
  }

  async function regenerateCommitMessage() {
    if (!gitState?.changes.length) return;
    setBusy(true); setError(""); setStatus("AI is regenerating the commit message…");
    try { await generateCommitMessage(gitState); setStatus("Commit message regenerated · edit it if needed"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate a commit message."); setStatus("Ready"); }
    finally { setBusy(false); }
  }

  async function compile(latex: string, kind: "master" | "tailored") {
    const response = await fetch("/api/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latex }) });
    if (!response.ok) throw new Error(await getError(response));
    return setPdf(await response.blob(), kind);
  }

  async function compileMaster() {
    if (!resume) return;
    setBusy(true); setError(""); setStatus("Compiling the master resume…");
    try { if (editorDirty && activeFile === project?.mainFile) await saveFile(); await compile(resume, "master"); setStatus("PDF preview updated"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not compile the resume."); }
    finally { setBusy(false); }
  }

  async function tailor() {
    if (!ready) return;
    setBusy(true); setError(""); setResult(null); setStatus("Finding the strongest match…");
    try {
      const response = await fetch("/api/tailor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latex: resume, jobDescription, verifiedFacts }) });
      if (!response.ok) throw new Error(await getError(response));
      const tailored: TailorResult = await response.json(); setTailorSource(resume); setResult(tailored); setStatus("Saving local draft…");
      const session = await persistTailorResult(tailored); setStatus("Compiling the tailored resume…");
      const compiled = await compile(tailored.tailored_latex, "tailored"); await persistTailorPdf(compiled.blob, session.id); setStatus("Tailored resume ready · saved locally");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Something went wrong."); setStatus("Ready"); }
    finally { setBusy(false); }
  }

  async function refineTailored(remember = false) {
    if (!result || followUp.trim().length < 3) return;
    const requestedRevision = followUp.trim();
    setBusy(true); setError(""); setStatus("Refining the tailored resume…");
    try {
      const response = await fetch("/api/tailor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latex: tailorSource || resume, jobDescription, verifiedFacts, currentDraft: result.tailored_latex, followUp: requestedRevision }) });
      if (!response.ok) throw new Error(await getError(response));
      const refined: TailorResult = await response.json(); setResult(refined); setStatus("Saving refined local draft…");
      const session = await persistTailorResult(refined); setStatus("Compiling the refined resume…");
      const compiled = await compile(refined.tailored_latex, "tailored"); await persistTailorPdf(compiled.blob, session.id);
      if (remember) { setStatus("Remembering this preference for future leads…"); await rememberTailoringFeedback(requestedRevision); }
      setFollowUp(""); setStatus(remember ? "Refined resume ready · preference remembered" : "Refined resume ready · saved locally");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refine the tailored resume."); setStatus("Ready"); }
    finally { setBusy(false); }
  }

  async function applyTailored() {
    if (!result) return;
    const main = project?.mainFile || "resume.tex";
    setActiveFile(main); setEditor(result.tailored_latex); setResume(result.tailored_latex); setView("studio");
    await saveFile(main, result.tailored_latex);
  }

  return (
    <main className="app-shell">
      <header className="topbar app-topbar">
        <button className="brand brand-button" onClick={() => setView("studio")}><span className="brand-mark">RF</span><span>RoleFit</span></button>
        <nav className="view-tabs" aria-label="Workspace views">
          <button className={view === "studio" ? "active" : ""} onClick={() => setView("studio")}>Studio</button>
          <button className={view === "tailor" ? "active" : ""} onClick={() => setView("tailor")}>Tailor</button>
        </nav>
        <div className="privacy-note"><span /> Local workspace · Git-backed</div>
      </header>

      {view === "studio" ? (
        <>
          <section className="studio-head">
            <div><p className="eyebrow">Resume project</p><h1>Local resume studio</h1><p>{project?.exists ? `${project.files.length} files · ${gitState?.changes.length || 0} uncommitted changes` : "Import your LaTeX project to begin."}</p></div>
            <div className="studio-controls">
              <label>Branch<select value={gitState?.branch || "main"} onChange={(event) => void gitAction("switch", { name: event.target.value })} disabled={busy || !gitState?.branches.length}>{(gitState?.branches.length ? gitState.branches : [gitState?.branch || "main"]).map((branch) => <option key={branch}>{branch}</option>)}</select></label>
              <button className="tool-button" onClick={() => setShowBranch(!showBranch)} disabled={!project?.exists}>＋ Branch</button>
              <button className="tool-button" onClick={() => void gitAction("pull")} disabled={busy || !gitState?.remote}>↓ Pull</button>
              <button className="tool-button strong" onClick={() => void gitAction("push")} disabled={busy || !gitState?.remote}>↑ Push</button>
            </div>
          </section>

          {showBranch && <div className="branch-bar"><input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="application/company-role" onKeyDown={(event) => { if (event.key === "Enter") void gitAction("branch", { name: branchName }); }} /><button onClick={() => void gitAction("branch", { name: branchName })} disabled={!branchName || busy}>Create branch</button></div>}

          {!project?.exists ? (
            <section className="empty-project">
              <span className="empty-mark">T<small>E</small>X</span><p className="eyebrow">Start the source of truth</p><h2>Bring your resume project home.</h2><p>Import the main `.tex` file and any supporting styles, fonts, images, or bibliography. RoleFit creates a private Git repository on this Mac.</p>
              <div>{resume && <button className="secondary-button" onClick={startFromSavedResume}>Use saved resume</button>}<label className="primary-link">Import ZIP or files<input type="file" accept=".zip,.tex,.text,.sty,.cls,.bib,.bst,.txt,.md,.yaml,.yml,.json,.csv,.png,.jpg,.jpeg,.gif,.webp,.pdf,.eps" multiple onChange={importFiles} /></label></div>
              <small>Your files and every Git version stay in the local RoleFit workspace.</small>
            </section>
          ) : (
            <section className="studio-grid">
              <aside className="file-rail">
                <div className="rail-title"><span>Project</span><label title="Add ZIP or project files">＋<input type="file" accept=".zip,.tex,.text,.sty,.cls,.bib,.bst,.txt,.md,.yaml,.yml,.json,.csv,.png,.jpg,.jpeg,.gif,.webp,.pdf,.eps" multiple onChange={importFiles} /></label></div>
                <div className="file-list">{project.files.map((file) => <button key={file.path} className={activeFile === file.path ? "active" : ""} onClick={() => void loadFile(file.path)}><span className={`file-kind ${file.kind}`}>{file.kind === "tex" ? "TeX" : file.kind === "image" ? "IMG" : "SRC"}</span><span>{file.path}</span>{file.path === project.mainFile && <small>main</small>}</button>)}</div>
                <div className="remote-card"><span className={gitState?.remote ? "status-dot good" : "status-dot muted"} /><div><b>{gitState?.remote ? "Git remote connected" : "Local Git"}</b><small>{gitState?.remote || "History and branches stay on this Mac"}</small></div></div>
              </aside>
              <section className="editor-pane">
                <div className="pane-bar"><div><b>{activeFile || "No file selected"}</b>{editorDirty && <span className="unsaved">unsaved</span>}</div><div><button onClick={() => void saveFile()} disabled={!activeFile || !editorDirty || busy}>Save</button><button className="compile-button" onClick={compileMaster} disabled={!resume || busy}>Build PDF</button></div></div>
                <LatexCodeEditor value={editor} onChange={(value) => { setEditor(value); if (activeFile === project.mainFile) setResume(value); }} onSave={() => void saveFile()} />
                <div className="editor-status"><span>{editor.split("\n").length} lines</span><span>{editor.length.toLocaleString()} characters</span><span>⌘S to save</span></div>
              </section>
              <section className="preview-pane">
                <div className="pane-bar"><b>PDF preview</b>{pdfUrl && <a href={pdfUrl} download="resume.pdf">Download</a>}</div>
                {pdfUrl ? <iframe title="Resume PDF preview" src={`${pdfUrl}#navpanes=0&zoom=100`} /> : <div className="preview-empty"><span>PDF</span><p>Build the main document to preview it here.</p><button onClick={compileMaster} disabled={!resume || busy}>Build now</button></div>}
              </section>
            </section>
          )}

          {project?.exists && <section className={studioAi.panel}>
            <div className={studioAi.copy}><div><p className="eyebrow">AI editing assistant</p><h2>Describe a change to <b>{activeFile || "the active file"}</b></h2></div><p>AI prepares a proposal only. Load it into the editor, review the highlighted source, then save when you are satisfied.</p></div>
            <div className={studioAi.compose}><textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Examples: tighten the CapTech bullets, fix inconsistent spacing, or reorganize skills without adding unsupported claims" aria-label="Describe a Studio AI edit" /><button className="tool-button strong" onClick={() => void requestStudioEdit()} disabled={busy || !activeFile || !editor || aiPrompt.trim().length < 5}>✦ Propose edit</button></div>
            {aiProposal && <div className={studioAi.proposal}><div><span>Proposal for {aiProposal.fileName}</span><h3>{aiProposal.summary[0] || "Proposed file update"}</h3>{aiProposal.summary.slice(1).map((item) => <p key={item}>↗ {item}</p>)}{!!aiProposal.warnings.length && <div className={studioAi.warnings}><b>Review carefully</b>{aiProposal.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}<small>Suggested commit: {aiProposal.commit_message}</small></div><div><button className="text-button" onClick={() => setAiProposal(null)}>Discard</button><button className="tool-button strong" onClick={applyStudioProposal} disabled={aiProposal.fileName !== activeFile}>Load into editor</button></div></div>}
          </section>}

          {project?.exists && <section className="git-dock">
            <div className="git-summary">
              <div className="dock-title"><div><p className="eyebrow">Version control</p><h2>Changes</h2></div><span>{gitState?.ahead || 0} ahead · {gitState?.behind || 0} behind</span></div>
              <div className="change-list">{gitState?.changes.length ? gitState.changes.map((change) => <div key={change.path}><span>{change.status}</span><b>{change.path}</b></div>) : <p>Working tree clean. Your project matches the latest commit.</p>}</div>
              <div className="commit-box"><div><input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder={gitState?.changes.length ? "Generated automatically after save" : "No changes to commit"} onKeyDown={(event) => { if (event.key === "Enter") void gitAction("commit", { message: commitMessage }); }} /><button className="ai-commit-button" onClick={() => void regenerateCommitMessage()} disabled={busy || !gitState?.changes.length} title="Regenerate the commit message from the current Git diff">✦ Regenerate</button></div><button onClick={() => void gitAction("commit", { message: commitMessage })} disabled={busy || !commitMessage || !gitState?.changes.length}>Commit changes</button></div>
            </div>
            <div className="diff-panel"><div className="dock-title"><div><p className="eyebrow">Review</p><h2>Diff</h2></div></div><pre>{gitState?.diff || (gitState?.changes.length ? "New files will appear in the diff after the first commit." : "No textual changes to review.")}</pre></div>
            <div className="history-panel"><div className="dock-title"><div><p className="eyebrow">Timeline</p><h2>History</h2></div></div><div>{gitState?.history.length ? gitState.history.map((commit, index) => <article key={commit.sha}><span className={index === 0 ? "commit-dot current" : "commit-dot"} /><div><b>{commit.subject}</b><p>{commit.short} · {commit.relative}</p></div></article>) : <p className="no-history">Your first commit will establish the project baseline.</p>}</div></div>
          </section>}
        </>
      ) : (
        <>
          <section className="tailor-hero"><div><p className="eyebrow">Application workspace</p><h1>Tailor from your <em>source of truth.</em></h1><p>RoleFit edits the current main document, preserves factual truth, and lets you bring the result back into the Studio as a reviewable Git change.</p></div><div className="system-card"><p className="system-label">Local setup</p><div><span className={health?.compiler ? "status-dot good" : "status-dot"} /> PDF compiler <b>{health?.compiler || "not found"}</b></div><div><span className={health?.apiKey ? "status-dot good" : "status-dot"} /> OpenAI key <b>{health?.apiKey ? "ready" : "add to .env.local"}</b></div><div><span className={project?.exists ? "status-dot good" : "status-dot muted"} /> Git project <b>{project?.exists ? gitState?.branch || "ready" : "not created"}</b></div></div></section>
          <section className={applicationSwitcher.bar}><div className={applicationSwitcher.selector}><div><b>Application variants</b><small>{variants.length ? `${variants.length} saved locally` : "No saved variants yet"}</small></div><select value={activeVariantId} onChange={(event) => void selectVariant(event.target.value)} disabled={busy} aria-label="Active application variant"><option value="">＋ New unsaved application</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}{variant.branch !== "main" ? ` · ${variant.branch}` : ""}</option>)}</select></div><div className={applicationSwitcher.actions}><button onClick={newVariant} disabled={busy}>＋ New</button><button onClick={() => void duplicateVariant()} disabled={busy || !activeVariantId || !result}>Duplicate</button><button onClick={() => void renameVariant()} disabled={busy || !activeVariantId}>Rename</button></div></section>
          <section className="workspace tailor-workspace">
            <article className="panel resume-panel"><div className="step"><span>01</span><div><p>Source of truth</p><h2>{project?.mainFile || "Your master resume"}</h2></div></div><div className="source-row"><div className="file-chip"><span className="file-icon">T<small>E</small>X</span><div><b>{project?.exists ? `Local project · ${gitState?.branch || "main"}` : "Saved on this device"}</b><small>{resume ? `${resume.length.toLocaleString()} characters${project?.exists ? " · edit in Studio" : ""}` : "Import a resume in Studio"}</small></div></div><button className="small-button" onClick={() => setView("studio")}>Open Studio</button></div><textarea className="latex-editor" value={resume} readOnly={project?.exists} onChange={(event) => { setResume(event.target.value); window.localStorage.setItem(STORAGE_KEY, event.target.value); }} placeholder="Paste your complete LaTeX resume here…" spellCheck={false} aria-label="Master resume LaTeX" /><div className="panel-actions"><button className="text-button" onClick={() => setView("studio")}>View Git changes</button><button className="text-button" onClick={compileMaster} disabled={busy || !resume}>Preview master PDF</button></div></article>
            <article className="panel job-panel">
              <div className="step"><span>02</span><div><p>The target</p><h2>Job description</h2></div></div>
              {linkedOpportunity && <div className="opportunity-link-banner"><span>SB</span><div><b>{linkedOpportunity.company}</b><small>{linkedOpportunity.role} · linked to this variant</small></div><a href="http://localhost:3000" target="_blank" rel="noreferrer">Open Searchboard</a></div>}
              {!linkedOpportunity && activeVariantId && searchboard?.connected && <div className="opportunity-link-banner opportunity-link-picker"><span>SB</span><div><b>Link this orphaned résumé</b><select value={linkOpportunityId} onChange={(event) => setLinkOpportunityId(event.target.value)} aria-label="Searchboard lead to link"><option value="">Choose a Searchboard lead…</option>{linkableOpportunities.map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.company} — {opportunity.role}</option>)}</select></div><button type="button" onClick={() => void linkCurrentVariant()} disabled={busy || !linkOpportunityId}>Link</button></div>}
              <textarea className="job-editor" value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder="Paste the full job description here. Include responsibilities, qualifications, and company context for the best match." aria-label="Job description" />
              <div className="count-row"><span>{wordCount} words</span><span>{jobDescription.length.toLocaleString()} characters</span></div>
              <label className="verified-facts">
                <span>User-verified facts <small>Optional · saved with this variant</small></span>
                <textarea value={verifiedFacts} onChange={(event) => setVerifiedFacts(event.target.value)} maxLength={20_000} placeholder="Add truthful experience or skills that are missing from the master résumé. Example: Used Terraform to maintain AWS infrastructure for an internal project." aria-label="User-verified facts" />
                <small>RoleFit may use these statements as factual evidence. Enter claims only—not editing instructions—and review the generated résumé before using it.</small>
              </label>
              <details className="tailoring-preferences">
                <summary><span>Tailoring preferences</span><small>{tailoringPreferenceCount ? `${tailoringPreferenceCount} remembered` : "No remembered rules"}</small></summary>
                <textarea value={tailoringPreferences} onChange={(event) => setTailoringPreferences(event.target.value)} maxLength={20_000} placeholder={"One reusable rule per line.\nExample: Keep strong quantified outcomes even when reordering bullets."} aria-label="Remembered tailoring preferences" />
                <div><small>These guide every future lead. Keep application-specific facts in the field above.</small><button type="button" onClick={() => void saveTailoringPreferences()} disabled={busy || tailoringPreferences === savedTailoringPreferences}>Save preferences</button></div>
              </details>
              <div className="truth-card"><span className="shield">✓</span><div><b>Truth lock uses both evidence sources</b><p>The model may use your master résumé and the verified facts above, but cannot invent claims beyond either source.</p></div></div>
              <button className="primary-button" onClick={tailor} disabled={busy || !ready}>{busy ? <span className="spinner" /> : <span>✦</span>} {busy ? status : "Tailor resume & build PDF"}</button>
              {!ready && <p className="button-hint">Add a resume and at least a short job description to continue.</p>}
            </article>
          </section>
          {result && <section className="result-section">
            <div className="result-heading"><div><p className="eyebrow">Result</p><h2>Your targeted resume is ready.</h2>{sessionUpdatedAt && <p className="session-note"><span /> Saved locally on <b>{sessionBranch || gitState?.branch || "main"}</b> · not in Git or the cloud</p>}</div><div className="result-actions"><button className="secondary-button" onClick={() => void applyTailored()}>Apply to project</button><button className="secondary-button" onClick={() => downloadText(result.tailored_latex, `${tailoredDownloadName}.tex`)}>Download .tex</button>{pdfUrl && pdfKind === "tailored" && <a className="primary-link" href={pdfUrl} download={`${tailoredDownloadName}.pdf`}>Download PDF</a>}<button className="text-button discard-draft" onClick={() => void discardTailorSession()}>Discard draft</button></div></div>
            <div className={tailorFollowUp.panel}>
              <div className={tailorFollowUp.copy}><p>Follow up</p><h3>Refine this result</h3><small>Apply feedback once, or remember a reusable preference for future leads. Factual claims still require résumé or user-verified evidence.</small></div>
              <div className={tailorFollowUp.compose}>
                <textarea value={followUp} onChange={(event) => setFollowUp(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void refineTailored(); }} placeholder="Try: Keep quantified outcomes when reordering bullets, avoid repetitive openings, or make this application more concise." aria-label="Follow-up instructions for the tailored resume" />
                <div className={tailorFollowUp.actions}>
                  <button onClick={() => void refineTailored()} disabled={busy || followUp.trim().length < 3}>✦ Refine once</button>
                  <button className={tailorFollowUp.remember} onClick={() => void refineTailored(true)} disabled={busy || followUp.trim().length < 3}>＋ Refine & remember</button>
                </div>
              </div>
            </div>
            <div className="result-grid"><div className="change-card"><h3>What changed</h3><ul>{result.changes.map((change) => <li key={change}>{change}</li>)}</ul>{!!result.matched_keywords.length && <><h3>Language aligned</h3><div className="keyword-list">{result.matched_keywords.map((word) => <span key={word}>{word}</span>)}</div></>}{!!result.warnings.length && <div className="warning"><b>Worth reviewing</b>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}</div><div className="pdf-card">{pdfUrl && pdfKind === "tailored" ? <iframe title="Tailored resume PDF preview" src={`${pdfUrl}#navpanes=0&zoom=100`} /> : <div className="pdf-empty">The tailored source is saved locally. Rebuild the PDF to preview it.</div>}</div></div>
          </section>}
        </>
      )}

      {error && <div className="error-toast" role="alert"><div><b>Couldn’t finish that</b><span>{error}</span></div><button onClick={() => setError("")}>×</button></div>}
      {busy && <div className="activity-pill"><span className="spinner" />{status}</div>}
      <footer><span>RoleFit Studio</span><p>One honest source. Every application tracked.</p><small>Model: {health?.model || "loading…"}</small></footer>
    </main>
  );
}
