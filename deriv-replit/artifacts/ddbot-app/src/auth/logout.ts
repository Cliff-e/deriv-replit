/**
 * logout.ts — fully ends a Deriv session.
 *
 * Steps:
 *   1. Reads the stored refresh_token.
 *   2. Calls POST /api/deriv/logout so the backend revokes it at Deriv's
 *      revocation endpoint (token is dead server-side immediately).
 *   3. Clears all auth data from localStorage regardless of the network result.
 *   4. Calls the optional onComplete callback (use it to redirect to login).
 *
 * Coexists with the legacy OAuth2Logout from @deriv-com/auth-client — if
 * both are present call derivLogout first, then OAuth2Logout.
 */

import { clearTokenStorage, REFRESH_TOKEN_KEY } from './refresh-token';

const LOGOUT_ENDPOINT = '/api/deriv/logout';

type LogoutOptions = {
    onComplete?: () => void;
};

export const derivLogout = async ({ onComplete }: LogoutOptions = {}): Promise<void> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

    if (refreshToken) {
        try {
            await fetch(LOGOUT_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken }),
            });
        } catch {
            // Network failure — proceed with local cleanup regardless.
        }
    }

    clearTokenStorage();
    onComplete?.();
};
