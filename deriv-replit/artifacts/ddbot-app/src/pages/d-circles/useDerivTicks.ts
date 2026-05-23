import { useEffect, useRef, useState } from 'react';

const WS_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=1089';

export const useDerivTicks = (symbol: string) => {
    const [tick, setTick] = useState<any>(null);
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        if (!symbol) return;

        // Close previous connection
        if (wsRef.current) {
            wsRef.current.close();
        }

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({
                ticks: symbol,
                subscribe: 1
            }));
        };

        ws.onmessage = (msg) => {
            const data = JSON.parse(msg.data);

            if (data.tick) {
                setTick(data.tick);
            }
        };

        ws.onerror = (err) => {
            console.error('WS Error:', err);
        };

        return () => {
            ws.close();
        };
    }, [symbol]);

    return tick;
};