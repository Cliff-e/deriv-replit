/**
 * Frontend utility for silently renewing a Deriv session.
 *
 * Called by useAutoRefresh when the stored token is approaching expiry.
 * On success it updates localStorage in the same shape as the PKCE callback.
 * On 401 it clears auth data so the app can redirect the user to login.
 */

const REFRESH_ENDPOINT = '/api/deriv/refresh-token';

/** localStorage key where we store the ISO expiry timestamp. */
export const TOKEN_EXPIRES_AT_KEY = 'deriv_token_expires_at';
/** localStorage key for the refresh token itself. */
export const REFRESH_TOKEN_KEY = 'deriv_refresh_token';

/** Store expiry info after a successful token exchange or refresh. */
export const storeTokenExpiry = (expiresInSeconds: number): void => {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    localStorage.setItem(TOKEN_EXPIRES_AT_KEY, String(expiresAt));
};

/** Return milliseconds until the stored token expires (negative = already expired). */
export const msUntilExpiry = (): number => {
    const raw = localStorage.getItem(TOKEN_EXPIRES_AT_KEY);
    if (!raw) return -1;
    return Number(raw) - Date.now();
};

/** Clears all auth + expiry data from localStorage. */
export const clearTokenStorage = (): void => {
    localStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem('authToken');
    localStorage.removeItem('active_loginid');
    localStorage.removeItem('accountsList');
    localStorage.removeItem('clientAccounts');
};

/**
 * Calls the backend refresh endpoint, updates stored tokens, and returns true.
 * Returns false if the refresh_token is missing or Deriv rejects the request,
 * in which case the caller should redirect to login.
 */
export const refreshDerivTokens = async (): Promise<boolean> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;

    let response: Response;
    try {
        response = await fetch(REFRESH_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
    } catch {
        return false;
    }

    if (response.status === 401 || response.status === 400) {
        clearTokenStorage();
        return false;
    }

    if (!response.ok) return false;

    let data: { tokens?: Record<string, string> };
    try {
        data = await response.json();
    } catch {
        return false;
    }

    const tokens = data.tokens ?? {};

    if (tokens.refresh_token) {
        localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
    }
    if (tokens.expires_in) {
        storeTokenExpiry(Number(tokens.expires_in));
    }
    if (tokens.token1) {
        localStorage.setItem('authToken', tokens.token1);
    }
    if (tokens.acct1) {
        localStorage.setItem('active_loginid', tokens.acct1);
    }

    return true;
};
