/**
 * useAccountSwitch — exposes the account list and a typed switchAccount action.
 *
 * Usage:
 *   const { accounts, activeLoginId, switchTo, isSwitching } = useAccountSwitch({
 *       onSwitched: () => window.location.reload(),
 *       onError:    (reason) => console.error(reason),
 *   });
 *
 * Pass onSwitched to trigger your app's reconnect / reload logic after
 * a successful switch. The hook never throws — errors go to onError.
 */

import { useCallback, useEffect, useState } from 'react';
import {
    ClientAccount,
    getActiveLoginId,
    getStoredAccounts,
    switchAccount,
} from './account-switch';

type Options = {
    onSwitched?: (loginid: string, currency: string) => void;
    onError?: (reason: string) => void;
};

type UseAccountSwitchResult = {
    accounts: ClientAccount[];
    activeLoginId: string | null;
    isSwitching: boolean;
    switchTo: (loginid: string) => Promise<void>;
};

const useAccountSwitch = ({ onSwitched, onError }: Options = {}): UseAccountSwitchResult => {
    const [activeLoginId, setActiveLoginId] = useState<string | null>(getActiveLoginId);
    const [isSwitching, setIsSwitching] = useState(false);

    const accounts = Object.values(getStoredAccounts());

    useEffect(() => {
        setActiveLoginId(getActiveLoginId());
    }, []);

    const switchTo = useCallback(
        async (loginid: string) => {
            if (isSwitching) return;
            setIsSwitching(true);

            const result = await switchAccount(loginid);

            setIsSwitching(false);

            if (result.success) {
                setActiveLoginId(result.loginid);
                onSwitched?.(result.loginid, result.currency);
            } else {
                onError?.(result.reason);
            }
        },
        [isSwitching, onSwitched, onError],
    );

    return { accounts, activeLoginId, isSwitching, switchTo };
};

export default useAccountSwitch;
