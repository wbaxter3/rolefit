# Security policy

## Supported versions

Security fixes are applied to the latest version on the `main` branch.

## Local-only trust model

RoleFit is designed for one trusted user on one computer. It has no account system and exposes powerful local APIs for reading and editing a resume project, compiling LaTeX, running Git operations, and making OpenAI API calls.

- Keep RoleFit bound to `127.0.0.1`.
- Do not deploy it to a public host or expose it through a tunnel or reverse proxy.
- Never commit `.env` files or anything under `data/`.
- Use synthetic resumes, job descriptions, and screenshots in bug reports.
- Treat imported LaTeX and ZIP projects as untrusted. Review them before compilation.
- Restrict extension access with `ROLEFIT_EXTENSION_ORIGINS` when the extension ID is stable.

The browser-extension header identifies the companion extension but is not an authentication secret. The loopback-only server binding is the primary security boundary.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for sensitive security issues. Do not include real resumes, API keys, contact details, or application data in a public issue.
