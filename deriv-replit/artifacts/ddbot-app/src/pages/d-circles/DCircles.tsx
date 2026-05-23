import React, { useEffect, useMemo, useRef, useState } from 'react';
import './dcircles.scss';
import { SYMBOLS } from './symbols';
import { analyzeSignals } from './signalEngine';

const WS_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=1089';
const TICK_LIMIT = 3000;

const DCircles = () => {
    const [symbol, setSymbol] = useState('R_75');
    const decimalsRef = useRef<Record<string, number>>({});
    

    // 📱 orientation state
    const [isLandscape, setIsLandscape] = useState(
        window.innerWidth > window.innerHeight
    );
    

    // 📦 load persisted data
    const [digitsMap, setDigitsMap] = useState<Record<string, number[]>>(() => {
        const saved = localStorage.getItem('digitsMap');
        return saved ? JSON.parse(saved) : {};
    });
    const [viewLimit, setViewLimit] = useState(1000);

// 👇 REQUIRED for the input to work
const inputRef = useRef<HTMLInputElement | null>(null);
const [inputValue, setInputValue] = useState<string>('1000');
const [isEditing, setIsEditing] = useState(false); 


    const wsRef = useRef<WebSocket | null>(null);

    // =========================
    // 🔥 ORIENTATION HANDLER (FIXED LOCATION)
    // =========================
    useEffect(() => {
        const handleResize = () => {
            setIsLandscape(window.innerWidth > window.innerHeight);
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, []);
    useEffect(() => {
    if (!isEditing) {
        setInputValue(String(viewLimit));
    }
}, [viewLimit, isEditing]);

    // =========================
    // 🔥 SAVE TO LOCALSTORAGE
    // =========================
    
    useEffect(() => {
        localStorage.setItem('digitsMap', JSON.stringify(digitsMap));
    }, [digitsMap]);

    // =========================
    // 🔥 WEBSOCKET (CLEAN)
    // =========================
 useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
        SYMBOLS.forEach(s => {
            ws.send(
                JSON.stringify({
                    ticks: s.value,
                    subscribe: 1
                })
            );
        });
    };

    ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (!data.tick) return;

        const sym = data.tick.symbol;
        const quote = data.tick.quote;

        if (quote === undefined || quote === null) return;

        let str = String(quote);

        if (str.includes('e')) {
            str = Number(quote).toFixed(10);
        }

        // =========================
        // 🔥 DETECT DECIMALS ONCE PER SYMBOL
        // =========================
        if (!decimalsRef.current[sym]) {
            const decimalPart = str.split('.')[1] || '';
            decimalsRef.current[sym] = decimalPart.length || 2;
        }

        const decimals = decimalsRef.current[sym];

        // =========================
        // 🔥 NORMALIZE
        // =========================
        const normalized = Number(quote).toFixed(decimals);

        // =========================
        // 🔥 LAST DIGIT
        // =========================
        const digit = Number(
            normalized.replace('.', '').slice(-1)
        );

        setDigitsMap(prev => {
            const prevDigits = prev[sym] || [];

            const updated =
                prevDigits.length >= TICK_LIMIT
                    ? [...prevDigits.slice(1), digit]
                    : [...prevDigits, digit];

            return {
                ...prev,
                [sym]: updated
            };
        });
    };

    return () => ws.close();
}, []);
    // =========================
    // CURRENT DATA
    // =========================
    const rawDigits = digitsMap[symbol] || [];

// 🔥 user-controlled view window
const digits =
    rawDigits.length > viewLimit
        ? rawDigits.slice(-viewLimit)
        : rawDigits;

    const latestDigit = digits.at(-1) ?? null;

    const total = digits.length || 1;

    // =========================
    // FREQUENCY
    // =========================
    const freq = useMemo(() => {
        const map: Record<number, number> = {};
        for (let i = 0; i < 10; i++) map[i] = 0;

        digits.forEach(d => map[d]++);
        return map;
    }, [digits]);

    // =========================
    // RANKING
    // =========================
    const ranked = useMemo(() => {
        return Object.entries(freq)
            .map(([digit, count]) => ({
                digit: Number(digit),
                count
            }))
            .sort((a, b) => b.count - a.count);
    }, [freq]);

    const most = ranked[0]?.digit;
    const secondMost = ranked[1]?.digit;
    const secondLeast = ranked[8]?.digit;
    const least = ranked[9]?.digit;

    const color = (d: number) => {
        if (d === most) return '#00ff66';
        if (d === secondMost) return '#3399ff';
        if (d === secondLeast) return '#ff9900';
        if (d === least) return '#ff3333';
        return '#555';
    };

    // =========================
    // SIGNALS
    // =========================
    const signals = useMemo(() => {
        return analyzeSignals(freq, total);
    }, [freq, total]);

    // =========================
    // STATS
    // =========================
    const over = digits.filter(d => d >= 5).length;
    const under = digits.filter(d => d < 5).length;

    const overPct = ((over / total) * 100).toFixed(1);
    const underPct = ((under / total) * 100).toFixed(1);

    const evenCount = digits.filter(d => d % 2 === 0).length;
    const oddCount = digits.filter(d => d % 2 !== 0).length;

    const evenPct = ((evenCount / total) * 100).toFixed(1);
    const oddPct = ((oddCount / total) * 100).toFixed(1);

    return (
        <div className={`dcircles-container ${isLandscape ? 'landscape' : 'portrait'}`}>

            <h3>DCircles (Live Multi-Market)</h3>

            {/* SYMBOL SELECTOR */}
            <select
                className="symbol-select"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
            >
                {SYMBOLS.map(s => (
                    <option key={s.value} value={s.value}>
                        {s.label}
                    </option>
                ))}
            </select>

            {/* CIRCLES */}
           {/* 🔵 CIRCLES */}
<div className="circles-grid">

    {/* TOP ROW: 0 - 4 */}
    <div className="circle-row">
        {Object.keys(freq).map(d => {
            const digit = Number(d);
            if (digit > 4) return null;

            const percent = (freq[digit] / total) * 100;
            const isActive = digit === latestDigit;

            return (
                <div key={digit} className="circle-wrapper">
                    <div
                        className={`circle ${isActive ? 'active' : ''}`}
                        style={{
                            borderColor: color(digit),
                            boxShadow: 'none'
                        }}
                    >
                        <span>{digit}</span>
                    </div>

                    {/* ✅ 2 DECIMALS */}
                    <small>{percent.toFixed(2)}%</small>
                </div>
            );
        })}
    </div>

    {/* BOTTOM ROW: 5 - 9 */}
    <div className="circle-row">
        {Object.keys(freq).map(d => {
            const digit = Number(d);
            if (digit < 5) return null;

            const percent = (freq[digit] / total) * 100;
            const isActive = digit === latestDigit;

            return (
                <div key={digit} className="circle-wrapper">
                    <div
                        className={`circle ${isActive ? 'active' : ''}`}
                        style={{
                            borderColor: color(digit),
                            boxShadow:
                                percent > 12
                                    ? `0 0 10px ${color(digit)}`
                                    : 'none'
                        }}
                    >
                        <span>{digit}</span>
                    </div>

                    {/* ✅ 2 DECIMALS */}
                    <small>{percent.toFixed(2)}%</small>
                </div>
            );
        })}
    </div>

</div> 
                {/*symbol selector */}

<div className="tick-control">
    <label>Ticks window: {viewLimit}</label>
   
<input
    ref={inputRef}
    type="text"
    value={inputValue}

    onFocus={() => setIsEditing(true)}

    onChange={(e) => {
        const val = e.target.value;

        // ✅ allow full delete
        if (val === '') {
            setInputValue('');
            return;
        }

        // ✅ allow only digits
        if (!/^\d+$/.test(val)) return;

        setInputValue(val);

        // 🔥 LIVE UPDATE (percentages update instantly)
        let num = Number(val);

        if (num < 50) num = 50;
        if (num > 3000) num = 3000;

        setViewLimit(num);
    }}

    onKeyDown={(e) => {
        if (e.key === 'Enter') {
            let val = Number(inputValue);

            if (isNaN(val)) val = 1000;
            if (val < 50) val = 50;
            if (val > 3000) val = 3000;

            setViewLimit(val);
            setInputValue(String(val));
            setIsEditing(false);

            // 🔥 FORCE blur AFTER render (fix blinking)
            setTimeout(() => {
                inputRef.current?.blur();
            }, 0);
        }
    }}

    onBlur={() => {
        let val = Number(inputValue);

        if (isNaN(val)) val = 1000;
        if (val < 50) val = 50;
        if (val > 3000) val = 3000;

        setViewLimit(val);
        setInputValue(String(val));
        setIsEditing(false);
    }}

    placeholder="Enter ticks (50–3000)"

    style={{
        width: '150px',
        padding: '10px 14px',
        fontSize: '16px',
        borderRadius: '12px',

        border: isEditing ? '2px solid orange' : '2px solid #555',
        background: '#1a1a1a',
        color: 'orange',

        textAlign: 'center',
        outline: 'none',
    }}
/>

</div>

            {/* EVEN / ODD */}
            <div className="even-odd">
                <div className="even" style={{ width: `${evenPct}%` }}>
                    Even {evenPct}%
                </div>
                <div className="odd" style={{ width: `${oddPct}%` }}>
                    Odd {oddPct}%
                </div>
            </div>

            {/* OVER / UNDER */}
            <div className="bar">
                <div className="over" style={{ width: `${overPct}%` }}>
                    Over {overPct}%
                </div>
                <div className="under" style={{ width: `${underPct}%` }}>
                    Under {underPct}%
                </div>
            </div>

            {/* SIGNALS */}
            <div className="signals">
                {signals.length === 0 && <p>No strong signal</p>}
                {signals.map((s, i) => (
                    <div key={i} className={`signal ${s.type?.toLowerCase()}`}>
                        {s.message}
                    </div>
                ))}
            </div>

            {/* STREAM */}
            <div className="stream">
                {digits.slice(-60).map((d, i, arr) => (
                    <span
                        key={i}
                        className={`tick ${i === arr.length - 1 ? 'active' : ''}`}
                    >
                        {d}
                    </span>
                ))}
            </div>

            {/* EVEN / ODD TICKER */}
            <div className="ticker-container">
                <div className="ticker-track">
                   {digits.slice(-20).map((d, i, arr) => {
    const isEven = d % 2 === 0;
    const isLatest = i === arr.length - 1;

                       return (
    <div
        key={i}
        className={`tick-box ${isEven ? 'even' : 'odd'} ${isLatest ? 'latest' : ''}`}
    >
        {isEven ? 'E' : 'O'}
    </div>
);
                    })}
                </div>

                
            </div>

        </div>
    );
};

export default DCircles;