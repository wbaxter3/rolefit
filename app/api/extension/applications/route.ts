import { NextResponse } from "next/server";
import { extensionOptions, extensionRequestAllowed, extensionResponseHeaders } from "../../../../lib/extension-access";
import { findExtensionApplication, writeExtensionApplication } from "../../../../lib/extension-persistence";

export const runtime = "nodejs";

function response(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: extensionResponseHeaders(request) });
}

export function OPTIONS(request: Request) {
  return extensionOptions(request);
}

export async function GET(request: Request) {
  try {
    if (!extensionRequestAllowed(request, "application-state")) return response(request, { error: "Request not allowed." }, 403);
    const url = new URL(request.url);
    const application = await findExtensionApplication({
      url: url.searchParams.get("url"),
      opportunityId: url.searchParams.get("opportunityId"),
      company: url.searchParams.get("company"),
      role: url.searchParams.get("role"),
    });
    return response(request, { application });
  } catch (reason) {
    return response(request, { error: reason instanceof Error ? reason.message : "Could not restore the application." }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    if (!extensionRequestAllowed(request, "application-state")) return response(request, { error: "Request not allowed." }, 403);
    const body = await request.json() as Record<string, unknown>;
    return response(request, { application: await writeExtensionApplication(body) });
  } catch (reason) {
    return response(request, { error: reason instanceof Error ? reason.message : "Could not save the application." }, 400);
  }
}
