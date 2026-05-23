/**
 * pages/AiBots.tsx — AI Bots page (route: /ai-bots)
 *
 * Renders the Advanced Strategy Bot inside the DerivAuthProvider so the
 * bot has access to the authenticated session.
 */

import React from 'react';
import { DerivAuthProvider } from '@/auth/DerivAuthContext';
import AiBotsComponent from '@/components/AiBots';

export default function AiBotsPage() {
    return (
        <DerivAuthProvider>
            <div style={{ padding: '20px', minHeight: '100vh', background: '#0a0a0a' }}>
                <AiBotsComponent />
            </div>
        </DerivAuthProvider>
    );
}
