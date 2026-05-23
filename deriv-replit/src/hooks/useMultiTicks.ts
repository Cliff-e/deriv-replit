import { useEffect, useState } from 'react';

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1086';

export const useMultiTicks = (symbols: string[]) => {
    const [tickMap, setTickMap] = useState<Record<string, number[]>>({});

    useEffect(() => {
        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            symbols.forEach(symbol => {
                ws.send(JSON.stringify({
                    ticks: symbol,
                    subscribe: 1
                }));
            });
        };

        ws.onmessage = (msg) => {
            const data = JSON.parse(msg.data);

            if (data.tick) {
                const symbol = data.tick.symbol;
                const quote = data.tick.quote;

                setTickMap(prev => {
                    const prevTicks = prev[symbol] || [];

                    return {
                        ...prev,
                        [symbol]: [...prevTicks, quote].slice(-100)
                    };
                });
            }
        };

        return () => ws.close();
    }, [symbols]);

    return tickMap;
};