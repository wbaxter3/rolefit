const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const FIREFOX_EXTENSION_ORIGIN = /^moz-extension:\/\/[A-Za-z0-9-]+$/;

function configuredOrigins() {
  return new Set(
    (process.env.ROLEFIT_EXTENSION_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function extensionOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (origin === new URL(request.url).origin) return true;
  const configured = configuredOrigins();
  if (configured.size) return configured.has(origin);
  return CHROME_EXTENSION_ORIGIN.test(origin) || FIREFOX_EXTENSION_ORIGIN.test(origin);
}

export function extensionResponseHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigin = origin && extensionOriginAllowed(request) ? origin : "";
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Headers": "Content-Type, X-RoleFit-Extension",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Cache-Control": "no-store",
  };
}

export function extensionRequestAllowed(request: Request, marker: string) {
  return extensionOriginAllowed(request) && request.headers.get("x-rolefit-extension") === marker;
}

export function extensionOptions(request: Request) {
  return new Response(null, {
    status: extensionOriginAllowed(request) ? 204 : 403,
    headers: extensionResponseHeaders(request),
  });
}
