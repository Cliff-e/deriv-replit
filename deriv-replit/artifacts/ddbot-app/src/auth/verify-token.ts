/**
 * verify-token.ts — validates the stored authToken against Deriv's API
 * before the app bootstraps.
 *
 * Call verifyStoredToken() early in your app tree (e.g. in AppRoot or
 * CoreStoreProvider). If it returns false, clear auth data and redirect
 * to login — the token is stale and will cause silent failures later.
 */

const VERIFY_ENDPOINT = '/api/deriv/verify-token';

export type VerifyResult =
    | { valid: true; loginid: string; currency: string; balance?: number }
    | { valid: false; reason: string };

/**
 * Sends the stored authToken to the backend for server-side validation.
 * Returns a typed result — never throws.
 */
export const verifyStoredToken = async (): Promise<VerifyResult> => {
    const token = localStorage.getItem('authToken');

    if (!token) {
        return { valid: false, reason: 'No token in storage' };
    }

    let response: Response;
    try {
        response = await fetch(VERIFY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });
    } catch {
        return { valid: false, reason: 'Network error — could not reach verify endpoint' };
    }

    let data: VerifyResult;
    try {
        data = await response.json();
    } catch {
        return { valid: false, reason: 'Invalid response from verify endpoint' };
    }

    return data;
};
