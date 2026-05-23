/**
 * useDerivAuth — consume the unified Deriv auth context.
 *
 * Must be used inside <DerivAuthProvider>. Throws a clear error if called
 * outside the provider so missing wrappers are caught during development.
 *
 * Returned shape:
 *
 *   isAuthenticated  boolean             — token verified by backend
 *   isVerifying      boolean             — startup check in flight
 *   activeLoginId    string | null       — e.g. "CR123456"
 *   accounts         ClientAccount[]     — all stored accounts (real + demo)
 *   isSwitching      boolean             — account-switch in flight
 *   logout           (opts?) => Promise  — revoke + clear session
 *   switchTo         (loginid) => Promise — validate + switch active account
 *
 * Example
 * -------
 *   const { isAuthenticated, isVerifying, logout } = useDerivAuth();
 *
 *   if (isVerifying) return <Loader />;
 *   if (!isAuthenticated) return null;
 */

export { useDerivAuthContext as useDerivAuth } from './DerivAuthContext';
export type { DerivAuthState } from './DerivAuthContext';
export type { ClientAccount } from './account-switch';
