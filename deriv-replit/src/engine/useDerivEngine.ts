import { useEffect, useRef, useState } from 'react';

type Candle = {
    open: number;
    high: number;
    low: number;
    close: number;
    epoch: number;
};

export const useDerivEngine = (symbol = 'R_100', candleSize = 5) => {
    const wsRef = useRef<WebSocket | null>(null);

    const [ticks, setTicks] = useState<number[]>([]);
    const [candles, setCandles] = useState<Candle[]>([]);

    const currentCandle = useRef<Candle | null>(null);

    useEffect(() => {
        const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        };

        ws.onmessage = (msg) => {
            const data = JSON.parse(msg.data);

            if (!data.tick?.quote) return;

            const price = Number(data.tick.quote);
            const digit = Math.floor(price * 10) % 10;
            const epoch = data.tick.epoch;

            // -----------------------
            // 1. TICKS (for DCircles)
            // -----------------------
            setTicks((prev) => {
                const updated = [...prev, digit];
                if (updated.length > 1200) updated.shift();
                return updated;
            });

            // -----------------------
            // 2. CANDLES (for chart sync)
            // -----------------------
            const bucket = Math.floor(epoch / candleSize);

            if (!currentCandle.current || currentCandle.current.epoch !== bucket) {
                currentCandle.current = {
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    epoch: bucket,
                };

                setCandles((prev) => {
                    const updated = [...prev, currentCandle.current!];
                    if (updated.length > 200) updated.shift();
                    return updated;
                });
            } else {
                const c = currentCandle.current;
                c.high = Math.max(c.high, price);
                c.low = Math.min(c.low, price);
                c.close = price;
            }
        };

        ws.onerror = console.error;

        ws.onclose = () => {};

        return () => ws.close();
    }, [symbol, candleSize]);

    return {
        ticks,
        candles,
    };
};