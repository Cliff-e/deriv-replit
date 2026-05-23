/**
 * DerivAuthContext — unified auth context for the Deriv PKCE login system.
 *
 * Wraps the following pieces into one consistent state tree:
 *   • Token verification  (verifyStoredToken)
 *   • Silent auto-refresh (refreshDerivTokens)
 *   • Multi-account switch (switchAccount)
 *   • Logout              (derivLogout)
 *
 * Usage
 * -----
 *   // 1. Wrap your app (or the authenticated section) once:
 *   <DerivAuthProvider onUnauthenticated={() => { window.location.href = '/'; }}>
 *       <App />
 *   </DerivAuthProvider>
 *
 *   // 2. Consume anywhere inside the tree:
 *   const { isAuthenticated, activeLoginId, accounts, logout, switchTo } = useDerivAuth();
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from 'react';
import { switchAccount, getStoredAccounts, getActiveLoginId, type ClientAccount } from './account-switch';
import { derivLogout } from './logout';
import { clearTokenStorage, msUntilExpiry, refreshDerivTokens } from './refresh-token';
import { verifyStoredToken } from './verify-token';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DerivAuthState = {
    isAuthenticated: boolean;
    isVerifying: boolean;
    activeLoginId: string | null;
    accounts: ClientAccount[];
    isSwitching: boolean;
    logout: (opts?: { onComplete?: () => void }) => Promise<void>;
    switchTo: (loginid: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const SKIP_PATHS = ['/callback', '/endpoint'];
const REFRESH_BEFORE_EXPIRY_MS = 60_000;
const MIN_SCHEDULE_MS = 5_000;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const DerivAuthContext = createContext<DerivAuthState | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type ProviderProps = {
    children: React.ReactNode;
    onUnauthenticated?: (reason: string) => void;
};

export const DerivAuthProvider = ({ children, onUnauthenticated }: ProviderProps) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isVerifying, setIsVerifying] = useState(true);
    const [activeLoginId, setActiveLoginId] = useState<string | null>(getActiveLoginId);
    const [isSwitching, setIsSwitching] = useState(false);

    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onUnauthenticatedRef = useRef(onUnauthenticated);
    onUnauthenticatedRef.current = onUnauthenticated;

    const scheduleRefresh = useCallback(() => {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

        const ms = msUntilExpiry();
        if (ms < 0) return;

        const delay = Math.max(ms - REFRESH_BEFORE_EXPIRY_MS, MIN_SCHEDULE_MS);

        refreshTimerRef.current = setTimeout(async () => {
            const success = await refreshDerivTokens();
            if (success) {
                setActiveLoginId(getActiveLoginId());
                scheduleRefresh();
            } else {
                setIsAuthenticated(false);
                setActiveLoginId(null);
                onUnauthenticatedRef.current?.('Session expired — silent refresh failed');
            }
        }, delay);
    }, []);

    useEffect(() => {
        const shouldSkip = SKIP_PATHS.some(p => window.location.pathname.startsWith(p));

        if (shouldSkip) {
            setIsVerifying(false);
            return;
        }

        const token = localStorage.getItem('authToken');
        if (!token) {
            setIsVerifying(false);
            return;
        }

        verifyStoredToken().then(result => {
            if (result.valid) {
                setIsAuthenticated(true);
                setActiveLoginId(getActiveLoginId());
                scheduleRefresh();
            } else {
                clearTokenStorage();
                onUnauthenticatedRef.current?.(result.reason);
            }
            setIsVerifying(false);
        });

        return () => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const logout = useCallback(
        async ({ onComplete }: { onComplete?: () => void } = {}) => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            await derivLogout({ onComplete });
            setIsAuthenticated(false);
            setActiveLoginId(null);
        },
        [],
    );

    const switchTo = useCallback(
        async (loginid: string) => {
            if (isSwitching) return;
            setIsSwitching(true);

            const result = await switchAccount(loginid);
            setIsSwitching(false);

            if (result.success) {
                setActiveLoginId(result.loginid);
            } else {
                clearTokenStorage();
                setIsAuthenticated(false);
                setActiveLoginId(null);
                onUnauthenticatedRef.current?.(result.reason);
            }
        },
        [isSwitching],
    );

    const accounts = Object.values(getStoredAccounts());

    const value: DerivAuthState = {
        isAuthenticated,
        isVerifying,
        activeLoginId,
        accounts,
        isSwitching,
        logout,
        switchTo,
    };

    return (
        <DerivAuthContext.Provider value={value}>
            {children}
        </DerivAuthContext.Provider>
    );
};

export const useDerivAuthContext = (): DerivAuthState => {
    const ctx = useContext(DerivAuthContext);
    if (!ctx) {
        throw new Error('useDerivAuth must be used inside <DerivAuthProvider>');
    }
    return ctx;
};
