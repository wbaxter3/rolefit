import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  extensionOptions,
  extensionOriginAllowed,
  extensionRequestAllowed,
  extensionResponseHeaders,
} from "../lib/extension-access.ts";

const endpoint = "http://127.0.0.1:3002/api/extension/profile";
const chromeOrigin = `chrome-extension://${"a".repeat(32)}`;
const firefoxOrigin = "moz-extension://3b5c93c2-6f59-4eb3-bad8-384b3f11e7a8";

function request(origin?: string, marker = "profile-state") {
  return new Request(endpoint, {
    headers: {
      ...(origin ? { origin } : {}),
      "x-rolefit-extension": marker,
    },
  });
}

afterEach(() => {
  delete process.env.ROLEFIT_EXTENSION_ORIGINS;
});

test("rejects ordinary web origins without reflecting CORS access", () => {
  const untrusted = request("https://example.com");
  assert.equal(extensionOriginAllowed(untrusted), false);
  assert.equal(extensionOptions(untrusted).status, 403);
  assert.equal(extensionResponseHeaders(untrusted)["Access-Control-Allow-Origin"], undefined);
});

test("allows Chrome and Firefox extension origins by default", () => {
  for (const origin of [chromeOrigin, firefoxOrigin]) {
    const trusted = request(origin);
    assert.equal(extensionOriginAllowed(trusted), true);
    assert.equal(extensionOptions(trusted).status, 204);
    assert.equal(extensionResponseHeaders(trusted)["Access-Control-Allow-Origin"], origin);
  }
});

test("allows same-origin and originless local requests", () => {
  assert.equal(extensionOriginAllowed(request("http://127.0.0.1:3002")), true);
  assert.equal(extensionOriginAllowed(request()), true);
});

test("uses the configured origin allowlist and still checks the request marker", () => {
  const configuredOrigin = `chrome-extension://${"b".repeat(32)}`;
  process.env.ROLEFIT_EXTENSION_ORIGINS = configuredOrigin;
  assert.equal(extensionOriginAllowed(request(chromeOrigin)), false);
  assert.equal(extensionRequestAllowed(request(configuredOrigin), "profile-state"), true);
  assert.equal(extensionRequestAllowed(request(configuredOrigin, "wrong-marker"), "profile-state"), false);
});
