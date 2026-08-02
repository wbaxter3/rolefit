# Contributing

Thanks for helping improve RoleFit.

## Development

1. Install Node.js 22 or newer.
2. Run `npm ci`.
3. Copy `.env.example` to `.env.local` and add only the values needed for your change.
4. Run `npm run dev` and open `http://localhost:3002`.
5. Run `npm run check` before opening a pull request.

Tectonic is required only for local PDF-compilation flows.

## Privacy

Never commit or attach real resumes, generated PDFs, API keys, career profiles, application answers, or job-search records. Use synthetic fixtures and redact screenshots. RoleFit ignores `data/` and environment files by default; do not weaken those protections.

## Pull requests

Keep changes focused, describe user-visible behavior, and call out any effect on the local-only security model. Security-sensitive reports should use private vulnerability reporting rather than a public issue.
