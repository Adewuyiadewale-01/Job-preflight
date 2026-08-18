import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, isEncryptedToken, TOKEN_PREFIX } from "../crypto";

const KEY = "local-dev-encryption-key-0123456789abcdef";

describe("token envelope encryption (AES-256-GCM)", () => {
  it("round-trips a token and stores it in the enc.v1 envelope", () => {
    const sealed = encryptToken(JSON.stringify({ accessToken: "ya29.fake" }), KEY);
    expect(sealed.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(isEncryptedToken(sealed)).toBe(true);
    expect(sealed).not.toContain("ya29.fake");
    expect(JSON.parse(decryptToken(sealed, KEY))).toEqual({ accessToken: "ya29.fake" });
  });

  it("fails closed with the wrong key", () => {
    const sealed = encryptToken("secret", KEY);
    expect(() => decryptToken(sealed, "a-different-key-aaaaaaaaaaaaaaaaaaaa")).toThrow();
  });

  it("refuses to encrypt with a dummy key", () => {
    expect(() => encryptToken("secret", "__dummy__")).toThrow(/dummy/);
  });

  it("rejects blobs that are not envelopes", () => {
    expect(() => decryptToken("plain-jwt-string", KEY)).toThrow(/envelope/);
  });
});
