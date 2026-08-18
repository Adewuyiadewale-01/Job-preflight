import { describe, expect, it, vi } from "vitest";
import { buildAuthorizationUrl, exchangeCode, sealToken, PROVIDER_SCOPES } from "../oauth";
import { loadConfig } from "../config";
import { decryptToken } from "../crypto";

const cfg = loadConfig({
  GOOGLE_OAUTH_CLIENT_ID: "google-client.apps.test",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  MICROSOFT_OAUTH_CLIENT_ID: "ms-client",
  MICROSOFT_OAUTH_CLIENT_SECRET: "ms-secret",
  APP_ENCRYPTION_KEY: "k".repeat(40),
  PUBLIC_ORIGIN: "http://localhost:3100",
});

describe("OAuth flows", () => {
  it("builds a Google authorization URL with read-only scope, PKCE and state", () => {
    const { authorizeUrl, state, codeVerifier } = buildAuthorizationUrl("gmail", cfg, () => "fixed-rand");
    const url = new URL(authorizeUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("google-client.apps.test");
    expect(url.searchParams.get("scope")).toBe(PROVIDER_SCOPES.gmail);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3100/api/oauth/gmail/callback");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(codeVerifier).toBe("fixed-rand");
    expect(url.searchParams.get("scope")).not.toContain("send"); // read-only
  });

  it("builds a Microsoft authorization URL with Mail.Read only", () => {
    const { authorizeUrl } = buildAuthorizationUrl("outlook", cfg, () => "r");
    const url = new URL(authorizeUrl);
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.searchParams.get("scope")).toContain("Mail.Read");
    expect(url.searchParams.get("scope")).not.toContain("Mail.Send");
  });

  it("refuses to build a URL when client ids are still dummy", () => {
    const dummyCfg = loadConfig({ APP_ENCRYPTION_KEY: "k".repeat(40) });
    expect(() => buildAuthorizationUrl("gmail", dummyCfg)).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
    expect(() => buildAuthorizationUrl("outlook", dummyCfg)).toThrow(/MICROSOFT_OAUTH_CLIENT_ID/);
  });

  it("routes Yahoo/Zoho to IMAP instead of an OAuth redirect", () => {
    expect(() => buildAuthorizationUrl("yahoo", cfg)).toThrow(/IMAP/);
  });

  it("exchanges the code at the provider token endpoint (stubbed fetch)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: "at-123", refresh_token: "rt-9", expires_in: 3600 }),
        { status: 200 }
      )
    );

    const token = await exchangeCode(
      "gmail",
      cfg,
      "auth-code",
      "verifier",
      fetchMock as unknown as typeof fetch
    );
    expect(token.accessToken).toBe("at-123");
    expect(token.refreshToken).toBe("rt-9");
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe("https://oauth2.googleapis.com/token");
    expect(String(init.body)).toContain("code=auth-code");
    expect(String(init.body)).toContain("code_verifier=verifier");
  });

  it("seals tokens into the encrypted envelope", () => {
    const sealed = sealToken({ accessToken: "at" }, cfg);
    expect(sealed.startsWith("enc.v1:")).toBe(true);
    expect(JSON.parse(decryptToken(sealed, cfg.appEncryptionKey))).toEqual({ accessToken: "at" });
  });
});
