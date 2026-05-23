/**
 * useTokenVerification — validates the stored token at app startup.
 *
 * Mount once near the root of the authenticated app tree (e.g. inside
 * CoreStoreProvider or AppRoot). On mount it calls verifyStoredToken()
 * and invokes onInvalid if the token is stale/absent, giving you a single
 * place to handle the redirect-to-login flow.
 *
 * Usage:
 *   useTokenVerification({
 *     onInvalid: () => { window.location.href = '/'; },
 *   });
 *
 * It skips verification on the /callback and /endpoint pages so those
 * flows are never interrupted mid-flight.
 */

import { useEffect } from 'react';
import { clearTokenStorage } from './refresh-token';
import { verifyStoredToken } from './verify-token';

type Options = {
    onInvalid?: (reason: string) => void;
    skip?: boolean;
};

const SKIP_PATHS = ['/callback', '/endpoint'];

const useTokenVerification = ({ onInvalid, skip = false }: Options = {}): void => {
    useEffect(() => {
        const shouldSkip =
            skip || SKIP_PATHS.some(p => window.location.pathname.startsWith(p));

        if (shouldSkip) return;

        const token = localStorage.getItem('authToken');
        if (!token) return;

        verifyStoredToken().then(result => {
            if (!result.valid) {
                clearTokenStorage();
                onInvalid?.(result.reason);
            }
        });
    }, []);
};

export default useTokenVerification;
