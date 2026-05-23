/**
 * pkce.ts — PKCE helpers for OAuth2 Authorization Code + PKCE flow.
 *
 * generateCodeVerifier  → cryptographically random 43-128 char string
 * generateCodeChallenge → S256 (SHA-256) challenge from the verifier
 * generateState         → random state string for CSRF protection
 */

/** Returns a base64url-encoded string from a Uint8Array. */
const base64url = (buf: ArrayBuffer): string =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

/** Generates a random code_verifier (43 chars). */
export const generateCodeVerifier = (): string => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64url(array.buffer);
};

/** Generates the S256 code_challenge from a verifier. */
export const generateCodeChallenge = async (verifier: string): Promise<string> => {
    const encoded = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return base64url(digest);
};

/** Generates a random state value for CSRF protection. */
export const generateState = (): string => {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return base64url(array.buffer);
};
