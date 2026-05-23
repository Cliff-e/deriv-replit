/**
 * Initiates the Deriv OAuth2 PKCE login flow.
 *
 * 1. Generates a code_verifier and S256 code_challenge.
 * 2. Generates a random state value.
 * 3. Stores both verifier and state in sessionStorage.
 * 4. Redirects the browser to the Deriv OAuth2 authorize endpoint.
 *
 * The callback page at /callback reads the stored verifier and state,
 * verifies the returned state, then forwards { code, code_verifier, redirect_uri }
 * to the backend for token exchange.
 */

import { getAppId } from '@/components/shared/utils/config/config';
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce';
import { storePkceState, storePkceVerifier } from './pkce-storage';

/** Resolve the correct Deriv OAuth domain based on the current hostname. */
const getPkceOAuthBaseUrl = (): string => {
    const hostname = window.location.hostname;
    if (hostname.includes('.deriv.me')) return 'https://oauth.deriv.me';
    if (hostname.includes('.deriv.be')) return 'https://oauth.deriv.be';
    return 'https://oauth.deriv.com';
};

const PKCE_REDIRECT_URI = `${window.location.origin}/callback`;

/**
 * Returns the app/client ID to use for the PKCE authorize request.
 * Priority: VITE_DERIV_APP_ID env var (set at build time) > existing getAppId() helper.
 */
const resolveClientId = (): string => {
    const viteAppId = import.meta.env.VITE_DERIV_APP_ID as string | undefined;
    if (viteAppId) return viteAppId;
    return String(getAppId());
};

/**
 * Kicks off the PKCE flow. Call this from a login button handler.
 * The function is async because challenge generation uses SubtleCrypto.
 */
export const initDerivPkceLogin = async (): Promise<void> => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = generateState();

    storePkceVerifier(verifier);
    storePkceState(state);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: resolveClientId(),
        redirect_uri: PKCE_REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        brand: 'deriv',
    });

    window.location.href = `${getPkceOAuthBaseUrl()}/oauth2/authorize?${params.toString()}`;
};
