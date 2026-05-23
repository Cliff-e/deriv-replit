import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import { useStore } from '@/hooks/useStore';
import { TicksStreamRequest } from '@deriv/api-types';
import { ChartTitle, SmartChart } from '@deriv/deriv-charts';
import { useDevice } from '@deriv-com/ui';
import ToolbarWidgets from './toolbar-widgets';
import DigitCircles from '../d-circles/DigitCircles';
import '@deriv/deriv-charts/dist/smartcharts.css';

type TSubscription = {
    [key: string]: { unsubscribe?: () => void } | null;
};

const subscriptions: TSubscription = {};

const Chart = observer(({ show_digits_stats }: { show_digits_stats: boolean }) => {
    const { common, ui, chart_store, run_panel, dashboard } = useStore();

    const {
        chart_type,
        getMarketsOrder,
        granularity,
        onSymbolChange,
        setChartStatus,
        symbol,
        updateChartType,
        updateGranularity,
        updateSymbol,
        setChartSubscriptionId,
        chart_subscription_id,
    } = chart_store;

    const { isDesktop, isMobile } = useDevice();
    const { is_drawer_open } = run_panel;
    const { is_chart_modal_visible } = dashboard;

    const [isSafari, setIsSafari] = useState(false);
    const [lastDigit, setLastDigit] = useState<number | null>(null);

    const [digits, setDigits] = useState<number[]>(() => {
        const saved = localStorage.getItem('digits_buffer');
        return saved ? JSON.parse(saved) : [];
    });

    const [displayCount, setDisplayCount] = useState<number>(() => {
    const saved = localStorage.getItem('digits_display_count');
    return saved ? Number(saved) : 100; // default
});
    const [inputValue, setInputValue] = useState<string>(() => {
    const saved = localStorage.getItem('digits_display_count');
    return saved ? saved : '100';
});

    const visibleDigits = useMemo(() => {
        return digits.slice(-displayCount);
    }, [digits, displayCount]);
    const [isEditing, setIsEditing] = useState(false);
    // ===============================
    // REFS (CRITICAL FIX)
    // ===============================
    const chartSubscriptionIdRef = useRef(chart_subscription_id);
    const precisionMapRef = useRef<Record<string, number>>({});
    const lastRawMapRef = useRef<Record<string, string>>({});

    const barriers = useMemo(() => [], []);

    // ===============================
    // SAFARI DETECT + CLEANUP
    // ===============================
    useEffect(() => {
        const ua = navigator.userAgent.toLowerCase();
        setIsSafari(
            ua.includes('safari') &&
            !ua.includes('chrome') &&
            !ua.includes('android')
        );

        return () => {
            chart_api.api.forgetAll('ticks');
        };
    }, []);

    useEffect(() => {
        chartSubscriptionIdRef.current = chart_subscription_id;
    }, [chart_subscription_id]);

    useEffect(() => {
        if (!symbol) updateSymbol();
    }, [symbol, updateSymbol]);

    useEffect(() => {
    localStorage.setItem('digits_display_count', String(displayCount));
}, [displayCount]);

    useEffect(() => {
    setInputValue(String(displayCount));
}, [displayCount]);
useEffect(() => {
    if (!isEditing) {
        setInputValue(String(displayCount));
    }
}, [displayCount, isEditing]);
    // ===============================
    // API WRAPPER
    // ===============================
    const requestAPI = useCallback((req) => {
        if (!chart_api?.api) return Promise.reject('API not ready');
        return chart_api.api.send(req);
    }, []);

    const requestForgetStream = useCallback((id: string) => {
        if (id) chart_api.api.forget(id);
    }, []);

    // ===============================
    // 🔥 CORE TICK ENGINE (FIXED)
    // ===============================
    const handleTick = useCallback((data: any) => {
        const tick = data?.tick;
        if (!tick || tick.quote === undefined) return;

        const symbol = tick.symbol;

        // ===============================
        // FORCE STRING (NO LOSS EVER)
        // ===============================
        const raw = String(tick.quote);

        // store last raw per symbol
        lastRawMapRef.current[symbol] = raw;

        // ===============================
        // DETECT PRECISION DYNAMICALLY
        // ===============================
        const decimalPart = raw.split('.')[1] || '';
        const detectedPrecision = decimalPart.length;

        // store best known precision
        if (!precisionMapRef.current[symbol]) {
            precisionMapRef.current[symbol] = detectedPrecision;
        } else {
            // keep max precision seen (important for volatility shifts)
            precisionMapRef.current[symbol] = Math.max(
                precisionMapRef.current[symbol],
                detectedPrecision
            );
        }

        const precision = precisionMapRef.current[symbol] ?? 2;

        // ===============================
        // NORMALIZE (SAFE PAD ONLY)
        // ===============================
        const [intPart, decPart = ''] = raw.split('.');

        const normalized =
            precision > 0
                ? `${intPart}.${decPart.padEnd(precision, '0')}`
                : intPart;

        // ===============================
        // DIGIT EXTRACTION (TRUE LAST DIGIT)
        // ===============================
        const digitStream = normalized.replace('.', '');
        const digit = Number(digitStream.slice(-1));

        setLastDigit(digit);

        setDigits(prev =>
            prev.length >= 3000
                ? [...prev.slice(-2999), digit]
                : [...prev, digit]
        );
    }, []);
   
    // ===============================
    // SUBSCRIPTION
    // ===============================
    const requestSubscribe = useCallback(
        async (req: TicksStreamRequest, callback: (data: any) => void) => {
            try {
                requestForgetStream(chartSubscriptionIdRef.current);

                const history = await chart_api.api.send(req);
                setChartSubscriptionId(history?.subscription.id);

                if (history) callback(history);

                if (req.subscribe === 1) {
                    const subId = history?.subscription.id;

                    subscriptions[subId]?.unsubscribe?.();

                    subscriptions[subId] =
                        chart_api.api.onMessage()?.subscribe(({ data }) => {
                            handleTick(data);
                            callback(data);
                        });
                }
            } catch (e: any) {
                console.log(e?.error?.message);
            }
        },
        [handleTick, requestForgetStream, setChartSubscriptionId]
    );

    // ===============================
    // UI WIDGETS
    // ===============================
    const toolbarWidget = useCallback(
        () => (
            <ToolbarWidgets
                updateChartType={updateChartType}
                updateGranularity={updateGranularity}
                position={!isDesktop ? 'bottom' : 'top'}
                isDesktop={isDesktop}
            />
        ),
        [isDesktop, updateChartType, updateGranularity]
    );

    const topWidgets = useCallback(
        () => <ChartTitle onChange={onSymbolChange} />,
        [onSymbolChange]
    );

    const settings = useMemo(
        () => ({
            assetInformation: false,
            countdown: true,
            isHighestLowestMarkerEnabled: false,
            language: common.current_language.toLowerCase(),
            position: ui.is_chart_layout_default ? 'bottom' : 'left',
            theme: ui.is_dark_mode_on ? 'dark' : 'light',
        }),
        [common.current_language, ui.is_chart_layout_default, ui.is_dark_mode_on]
    );

    // ===============================
    // CLEANUP
    // ===============================
    useEffect(() => {
        return () => {
            Object.values(subscriptions).forEach(sub =>
                sub?.unsubscribe?.()
            );
        };
    }, []);

    if (!symbol) return null;

    // ===============================
    // RENDER
    // ===============================
    return (
        <div
            className={classNames('dashboard__chart-wrapper', {
                'dashboard__chart-wrapper--expanded': is_drawer_open && isDesktop,
                'dashboard__chart-wrapper--modal': is_chart_modal_visible && isDesktop,
                'dashboard__chart-wrapper--safari': isSafari,
            })}
            style={{ position: 'relative', minHeight: '800px' }}
        >
            <SmartChart
                id="dbot"
                barriers={barriers}
                showLastDigitStats={show_digits_stats}
                chartControlsWidgets={null}
                enabledChartFooter={false}
                chartStatusListener={(v: boolean) => setChartStatus(!v)}
                toolbarWidget={toolbarWidget}
                chartType={chart_type}
                isMobile={isMobile}
                enabledNavigationWidget={isDesktop}
                granularity={granularity}
                requestAPI={requestAPI}
                requestForget={() => {}}
                requestForgetStream={() => {}}
                requestSubscribe={requestSubscribe}
                settings={settings}
                symbol={symbol}
                topWidgets={topWidgets}
                isConnectionOpened={!!chart_api?.api}
                getMarketsOrder={getMarketsOrder}
                isLive
                leftMargin={80}

                priceFormatter={(price: number) => {
                    const formatted = String(price);
                    const digitStream = formatted.replace('.', '');
                    const digit = Number(digitStream.slice(-1));
                    return `${formatted} • ${digit}`;
                }}
            />

            <div
                style={{
                    position: 'absolute',
                    bottom: 20,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 10,
                }}
            >
                <div
                    style={{
                        background: 'rgba(0,0,0,0.5)',
                        padding: '6px 10px',
                        borderRadius: '10px',
                    }}
                >
                    <DigitCircles digits={visibleDigits} />
                </div>
            </div>

    <div
    style={{
        position: 'absolute',
        bottom: 160,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
    }}
>
    <div style={{ textAlign: 'center', marginBottom: '4px', color: '#ccc', fontSize: '12px' }}>
        Digits to show
    </div>

<input
    type="number"
    value={inputValue}
    onFocus={() => setIsEditing(true)}
    onChange={e => {
        const val = e.target.value;

        if (val === '') {
            setInputValue('');
            return;
        }

        if (!/^\d+$/.test(val)) return;

        setInputValue(val);
         // 👇 LIVE UPDATE (optional)
    setDisplayCount(Number(val));
    }}
    onKeyDown={e => {
        if (e.key === 'Enter') {
            let val = Number(inputValue);

            if (isNaN(val)) val = 100;
            if (val < 10) val = 10;
            if (val > 3000) val = 3000;

            setDisplayCount(val);
            setInputValue(String(val));
            setIsEditing(false);

            // remove focus (feels more "confirmed")
            (e.target as HTMLInputElement).blur();
        }
    }}
    onBlur={() => {
        // optional fallback if user clicks away
        let val = Number(inputValue);

        if (isNaN(val)) val = 100;
        if (val < 10) val = 10;
        if (val > 3000) val = 3000;

        setDisplayCount(val);
        setInputValue(String(val));
        setIsEditing(false);
    }}
    style={{
        padding: '8px 12px',
        borderRadius: '10px',
        border: '1px solid #00ffcc',
        background: '#111',
        color: '#00ffcc',
        fontWeight: 600,
        width: '100px',
        textAlign: 'center',
    }}
/>
</div>
   
        </div>
    );
});

export default Chart;