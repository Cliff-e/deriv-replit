/**
 * pkce-storage.ts — sessionStorage helpers for the PKCE flow.
 *
 * The verifier and state must survive the redirect to Deriv's login page
 * and back to /callback. sessionStorage persists across same-tab redirects
 * but is cleared when the tab is closed, which is the right scope for auth.
 */

const KEY_VERIFIER = 'pkce_code_verifier';
const KEY_STATE = 'pkce_state';

export const storePkceVerifier = (verifier: string): void =>
    sessionStorage.setItem(KEY_VERIFIER, verifier);

export const getPkceVerifier = (): string | null =>
    sessionStorage.getItem(KEY_VERIFIER);

export const clearPkceVerifier = (): void =>
    sessionStorage.removeItem(KEY_VERIFIER);

export const storePkceState = (state: string): void =>
    sessionStorage.setItem(KEY_STATE, state);

export const getPkceState = (): string | null =>
    sessionStorage.getItem(KEY_STATE);

export const clearPkceState = (): void =>
    sessionStorage.removeItem(KEY_STATE);
