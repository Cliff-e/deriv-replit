import { useEffect, useState } from 'react';

const WS_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=1089';

export const useDigits = (symbol: string) => {
    const [digits, setDigits] = useState<number[]>(() => {
        const saved = localStorage.getItem('digits');
        return saved ? JSON.parse(saved) : [];
    });

    useEffect(() => {
        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            ws.send(JSON.stringify({
                ticks: symbol,
                subscribe: 1
            }));
        };

      ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    if (!data.tick) return;

    const quote = data.tick.quote;
    const digit = Math.floor(quote * 10) % 10;

    setDigits(prev => {
        const updated = [...prev.slice(-1000), digit];
        localStorage.setItem('digits', JSON.stringify(updated));
        return updated;
    });
};

        return () => ws.close();
    }, [symbol]);

    return digits;
};