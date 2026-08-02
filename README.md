# RoleFit Studio

An open-source, local-first LaTeX resume builder with a visual PDF workflow, built-in Git version control, and honest AI tailoring for individual job applications.

> [!IMPORTANT]
> RoleFit is a local desktop companion, not a hosted multi-user service. It intentionally has no authentication and its file, Git, compilation, and AI routes must not be exposed to the public internet.

## What it does

- Stores a complete resume project on disk under ignored `data/resume-project/`.
- Edits `.tex`, `.sty`, `.cls`, `.bib`, and other source files in the browser.
- Imports either loose project files or a complete `.zip` containing `.tex` and supporting assets.
- Keeps supporting images, fonts, PDFs, and project assets alongside the source.
- Compiles the main LaTeX document locally with Tectonic and shows the PDF beside the editor.
- Tracks file changes, textual diffs, commits, history, and local branches from the Studio.
- Uses OpenAI Structured Outputs to tailor the main resume without inventing experience.
- Lets the Brave extension attach the unchanged base résumé without an AI call, request a light reorder/minimal wording pass, or create a fully targeted variant.
- Supports application-specific user-verified facts for truthful experience or skills omitted from the master résumé, and uses them alongside the résumé during initial tailoring and follow-up refinements.
- Keeps multiple named application variants locally with instant switching, duplication, and renaming independent of Git branches.
- Accepts deep links from the sibling Searchboard project, opens prefilled tailoring workspaces, and durably links Searchboard opportunity IDs to RoleFit variant IDs.
- Offers proposal-first AI edits for any active Studio source file and automatically generates editable commit messages from the actual Git diff after saves and imports.
- Applies tailored results back to the project as normal, reviewable Git changes.

## Setup

Requirements: Node.js 22+, an OpenAI API key for tailoring, and [Tectonic](https://tectonic-typesetting.github.io/) for PDFs.

```bash
npm ci
cp .env.example .env.local
# Add your OPENAI_API_KEY to .env.local
brew install tectonic
npm run dev
```

Open [http://localhost:3002](http://localhost:3002), then import a ZIP project or select loose `.tex` and supporting files. A single top-level folder in a ZIP is removed automatically, relative project paths are preserved, and the first `.tex` file becomes the main document when `resume.tex` is absent. RoleFit initializes a private Git repository for the project. Make a first commit in the Version Control panel to establish the baseline.

When [Searchboard](https://github.com/wbaxter3/searchboard) lives at the default sibling path `../searchboard`, its resume actions connect automatically. Select an opportunity in Searchboard to create or reopen its linked RoleFit variant. If the projects live elsewhere, set `SEARCHBOARD_DATA_PATH` to Searchboard's `data/opportunities.json` file.

RoleFit atomically publishes linked variant, PDF, branch, update time, and resume-project commit status to `../.career-workspace/integration-registry.json`. Searchboard reads this through RoleFit and refreshes automatically while both local apps are running.

ZIP imports are limited to 25 MB compressed, 60 MB extracted, 500 files, and 20 MB per file. Unsafe paths, embedded Git repositories, symbolic links, encrypted entries, and extreme expansion ratios are rejected.

## Daily workflow

1. Use **Tailor** to create or switch between named application variants without changing the Git working tree.
2. Refine, compare, and review each variant's PDF independently.
3. When a variant is ready, optionally create an application branch such as `applications/acme-product`.
4. Apply the selected variant to the project, review the Git diff, and commit it.
5. Switch back to `main` to keep the canonical resume clean.

Local commits and branches require no remote service. If the project directory is later given a normal Git `origin`, the Studio's Pull and Push controls will use it.

## Where tailoring drafts live

RoleFit automatically saves each successful tailoring result, its job description, and its compiled PDF under ignored `data/tailor-sessions/`. Named application variants are local to this Mac, independent from Git branches, and restored after a reload.

Reusable feedback saved with **Refine & remember** is stored locally in ignored `data/tailoring-preferences.json` and automatically guides future tailoring from both the web app and browser extension. The Tailor view lets you review, edit, or remove remembered rules; application-specific facts remain separate.

- **Apply to project** writes the tailored LaTeX into the resume project's working tree. It is then an uncommitted Git change.
- **Commit changes** records that applied version in the resume project's local Git history.
- **Push** sends committed history to the project's configured remote. Until a remote is connected and Push succeeds, nothing is stored in GitHub or another cloud service.
- **Discard draft** removes only the selected application variant; it does not change the resume project or Git history.

The Brave extension's reusable career profile and completed-application index are also persisted locally under ignored `data/extension-profile.json` and `data/extension-applications.json`. Application records are keyed by normalized job URL and Searchboard opportunity ID when one exists; browser storage is only a reload-friendly cache.

## Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | Server-side OpenAI API credential | required for tailoring |
| `OPENAI_MODEL` | Model used by the Responses API; Sol is the quality-first default, while `gpt-5.6-terra` is a lower-cost option | `gpt-5.6-sol` |
| `OPENAI_FORM_MODEL` | Optional model override for structured application-profile and answer drafting | `OPENAI_MODEL` |
| `RESUME_MAIN_TEX` | Main document inside the project | `resume.tex` |
| `SEARCHBOARD_DATA_PATH` | Searchboard opportunities JSON file | sibling `../searchboard/data/opportunities.json` |
| `CAREER_REGISTRY_PATH` | Shared atomic opportunity/resume link registry | sibling `../.career-workspace/integration-registry.json` |
| `ROLEFIT_EXTENSION_ORIGINS` | Optional comma-separated browser-extension origin allowlist | Chrome and Firefox extension origins |

## Privacy and safety

The API key is only read by the local server. Project files, Git history, PDF compilation, and the canonical resume stay on this computer. Tailoring sends only the main resume source and pasted job description to OpenAI. Tectonic runs in untrusted mode, and the server rejects shell and unsafe file-read primitives.

The development and production commands bind to `127.0.0.1`. Extension APIs reject ordinary web origins and allow browser-extension origins only; set `ROLEFIT_EXTENSION_ORIGINS` when you want an explicit extension-ID allowlist. All files under `data/` are ignored because they may contain highly sensitive resume and application information.

See [SECURITY.md](SECURITY.md) before changing the host binding, reverse-proxying RoleFit, or sharing diagnostics.

## Checks

```bash
npm run check
```

## License

RoleFit is available under the [MIT License](LICENSE).
