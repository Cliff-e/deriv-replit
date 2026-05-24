/**
 * pages/AiBots.tsx — AI Bots page (route: /ai-bots)
 *
 * No longer wraps with DerivAuthProvider — the component reads
 * authToken directly from localStorage and auto-connects on mount.
 */
import React from 'react';
import AiBotsComponent from '@/components/AiBots';

export default function AiBotsPage() {
    return (
        <div style={{ height: '100vh', background: '#0c0c0c', overflow: 'hidden' }}>
            <AiBotsComponent />
        </div>
    );
}
