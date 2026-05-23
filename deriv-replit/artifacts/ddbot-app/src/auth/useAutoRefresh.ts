/**
 * useAutoRefresh — silently renews the Deriv session before it expires.
 *
 * Mount this hook once near the top of the authenticated app tree (e.g.
 * inside Layout or AppRoot). It will schedule a refresh 60 seconds before
 * the stored token expires. If the refresh fails it calls onRefreshFailed
 * so the app can redirect the user back to the login page.
 *
 * Usage:
 *   useAutoRefresh({ onRefreshFailed: () => window.location.href = '/' });
 */

import { useEffect, useRef } from 'react';
import { msUntilExpiry, refreshDerivTokens } from './refresh-token';

const REFRESH_BEFORE_EXPIRY_MS = 60_000;
const MIN_SCHEDULE_MS = 5_000;

type Options = {
    onRefreshFailed?: () => void;
};

const useAutoRefresh = ({ onRefreshFailed }: Options = {}): void => {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const schedule = () => {
            if (timerRef.current) clearTimeout(timerRef.current);

            const ms = msUntilExpiry();

            if (ms < 0) {
                return;
            }

            const delay = Math.max(ms - REFRESH_BEFORE_EXPIRY_MS, MIN_SCHEDULE_MS);

            timerRef.current = setTimeout(async () => {
                const success = await refreshDerivTokens();
                if (success) {
                    schedule();
                } else {
                    onRefreshFailed?.();
                }
            }, delay);
        };

        schedule();

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [onRefreshFailed]);
};

export default useAutoRefresh;
