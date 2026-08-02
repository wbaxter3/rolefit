import { NextResponse } from "next/server";
import { opportunityJobContext, readSearchboardOpportunities, searchboardDataPath } from "../../../lib/searchboard";
import { readTailorSession } from "../../../lib/tailor-session";
import { integrationRegistryPath, syncIntegrationRegistry } from "../../../lib/integration-registry";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [opportunities, stored] = await Promise.all([readSearchboardOpportunities(), readTailorSession()]);
    const links = new Map(stored.variants.filter((variant) => variant.opportunity?.id).map((variant) => [variant.opportunity!.id, variant]));
    const registry = await syncIntegrationRegistry(stored.variants);
    const registryLinks = new Map(registry.links.map((link) => [link.opportunityId, link]));
    return NextResponse.json({
      connected: true,
      sourcePath: searchboardDataPath(),
      registryPath: integrationRegistryPath(),
      registryUpdatedAt: registry.updatedAt,
      opportunities: opportunities.map((opportunity) => ({
        ...opportunity,
        jobContext: opportunityJobContext(opportunity),
        variant: links.get(opportunity.id) ? { ...links.get(opportunity.id), gitCommit: registryLinks.get(opportunity.id)?.gitCommit || null } : null,
      })),
    }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "http://localhost:3000" } });
  } catch (reason) {
    const code = (reason as NodeJS.ErrnoException).code;
    return NextResponse.json({ connected: false, opportunities: [], error: code === "ENOENT" ? "Searchboard data was not found. Start Searchboard once or set SEARCHBOARD_DATA_PATH." : reason instanceof Error ? reason.message : "Could not read Searchboard opportunities." }, { status: code === "ENOENT" ? 404 : 500, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "http://localhost:3000" } });
  }
}
