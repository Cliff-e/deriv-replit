import { useEffect, useRef, useState } from 'react';

const WS_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=1086';

const useMultiMarketScanner = (symbols: string[]) => {
    const [markets, setMarkets] = useState<any>({});
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            symbols.forEach(sym => {
                ws.send(JSON.stringify({
                    ticks: sym,
                    subscribe: 1
                }));
            });
        };

        ws.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (!data.tick) return;

            const { symbol, quote, display_decimals } = data.tick;

            const precision = display_decimals ?? 2;

            const digit = Number(
                quote.toFixed(precision).slice(-1)
            );

            setMarkets(prev => {
                const prevDigits = prev[symbol]?.digits || [];

                return {
                    ...prev,
                    [symbol]: {
                        digits: [...prevDigits.slice(-2999), digit],
                        lastDigit: digit
                    }
                };
            });
        };

        return () => ws.close();
    }, [symbols]);

    return markets;
};

export default useMultiMarketScanner;