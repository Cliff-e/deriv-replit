/**
 * account-switch.ts — switches the active Deriv account without re-login.
 *
 * The user may have several accounts stored from their initial login
 * (e.g. real USD + demo VR). This utility:
 *   1. Reads the target account's token from clientAccounts in localStorage.
 *   2. Calls the backend to validate the token is still good before committing.
 *   3. Updates authToken + active_loginid in localStorage.
 *   4. Calls onSwitched() so the app can reconnect / reload state.
 */

const SWITCH_ENDPOINT = '/api/deriv/account-switch';

export type ClientAccount = {
    loginid: string;
    token: string;
    currency: string;
};

/** Returns all stored accounts from localStorage, or an empty object. */
export const getStoredAccounts = (): Record<string, ClientAccount> => {
    try {
        return JSON.parse(localStorage.getItem('clientAccounts') ?? '{}');
    } catch {
        return {};
    }
};

/** Returns the currently active loginid. */
export const getActiveLoginId = (): string | null =>
    localStorage.getItem('active_loginid');

export type SwitchResult =
    | { success: true; loginid: string; currency: string }
    | { success: false; reason: string };

/**
 * Switches the active account to the given loginid.
 * Returns a typed result — never throws.
 */
export const switchAccount = async (loginid: string): Promise<SwitchResult> => {
    const accounts = getStoredAccounts();
    const target = accounts[loginid];

    if (!target) {
        return { success: false, reason: `Account ${loginid} not found in storage` };
    }

    if (target.loginid === getActiveLoginId()) {
        return { success: true, loginid: target.loginid, currency: target.currency };
    }

    let response: Response;
    try {
        response = await fetch(SWITCH_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loginid, token: target.token }),
        });
    } catch {
        return { success: false, reason: 'Network error — could not reach switch endpoint' };
    }

    let data: { success: boolean; reason?: string };
    try {
        data = await response.json();
    } catch {
        return { success: false, reason: 'Invalid response from switch endpoint' };
    }

    if (!data.success) {
        return { success: false, reason: data.reason ?? 'Switch rejected' };
    }

    localStorage.setItem('authToken', target.token);
    localStorage.setItem('active_loginid', target.loginid);

    return { success: true, loginid: target.loginid, currency: target.currency };
};
