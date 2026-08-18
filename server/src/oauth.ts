/**
 * OAuth 2.0 authorization-code + PKCE flows for the seed mailbox providers.
 *
 * - Google:    Gmail API, read-only scope
 * - Microsoft: Graph Mail.Read, read-only scope
 * - Yahoo/Zoho: no first-party OAuth for mail in most regions — IMAP with an
 *   app-specific password, stored through the same AES-256-GCM envelope.
 *
 * Secrets live in env (dummy defaults until the user fills .env); tokens are
 * encrypted with encryptToken() before storage and only decrypted in memory
 * when an adapter needs them.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Provider } from "../../shared/types";
import { encryptToken } from "./crypto";
import type { ServerConfig } from "./config";

export const PROVIDER_SCOPES: Record<string, string> = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  outlook: "https://graph.microsoft.com/Mail.Read offline_access",
};

export interface OAuthStartResult {
  authorizeUrl: string;
  state: string;
  codeVerifier: string;
}

const pkce = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

export function buildAuthorizationUrl(
  provider: Provider,
  cfg: ServerConfig,
  rand: () => string = () => randomBytes(24).toString("base64url")
): OAuthStartResult {
  const redirectUri = `${cfg.publicOrigin}/api/oauth/${provider}/callback`;
  const state = rand();
  const verifier = rand();

  if (provider === "gmail") {
    if (cfg.googleOAuthClientId === "__dummy__")
      throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured — add it to .env first.");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", cfg.googleOAuthClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", PROVIDER_SCOPES.gmail);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pkce(verifier));
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizeUrl: url.toString(), state, codeVerifier: verifier };
  }

  if (provider === "outlook") {
    if (cfg.microsoftOAuthClientId === "__dummy__")
      throw new Error("MICROSOFT_OAUTH_CLIENT_ID is not configured — add it to .env first.");
    const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    url.searchParams.set("client_id", cfg.microsoftOAuthClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", PROVIDER_SCOPES.outlook);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pkce(verifier));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("response_mode", "query");
    return { authorizeUrl: url.toString(), state, codeVerifier: verifier };
  }

  throw new Error(`${provider} connects via IMAP + app password, not an OAuth redirect.`);
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

/** Exchanges the authorization code at the provider's token endpoint. `fetchImpl` is injected for tests. */
export async function exchangeCode(
  provider: Provider,
  cfg: ServerConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch
): Promise<TokenResponse> {
  const redirectUri = `${cfg.publicOrigin}/api/oauth/${provider}/callback`;

  if (provider === "gmail") {
    const body = new URLSearchParams({
      client_id: cfg.googleOAuthClientId,
      client_secret: cfg.googleOAuthClientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    const res = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
    const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
      scope: j.scope,
    };
  }

  if (provider === "outlook") {
    const body = new URLSearchParams({
      client_id: cfg.microsoftOAuthClientId,
      client_secret: cfg.microsoftOAuthClientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    const res = await fetchImpl("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Microsoft token exchange failed (${res.status})`);
    const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
      scope: j.scope,
    };
  }

  throw new Error(`${provider} has no OAuth token endpoint — use the IMAP flow.`);
}

/** Wraps a raw token payload into the encrypted envelope used for storage. */
export function sealToken(token: TokenResponse, cfg: ServerConfig): string {
  return encryptToken(JSON.stringify(token), cfg.appEncryptionKey);
}
