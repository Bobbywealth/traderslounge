from pathlib import Path
import re

path = Path('src/pages/TradingView.tsx')
text = path.read_text()
original = text


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'Expected one match, found {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)


replace_once(
    "import { bwtsApi, type ChartAiAnalysis, type CryptoAnalysis } from '../services/bwtsApi';\n",
    "import { bwtsApi, type ChartAiAnalysis, type CryptoAnalysis } from '../services/bwtsApi';\n"
    "import { useCandles } from '../features/chart/useCandles';\n"
    "import type { CandlestickData } from '../features/chart/chartData';\n",
)

text, count = re.subn(
    r"\ninterface CandlestickData \{.*?\n\}\n\ninterface LineDataPoint",
    "\ninterface LineDataPoint",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove local CandlestickData interface')

text, count = re.subn(
    r"\ninterface TradeLockerHistoryCandle \{.*?\n\}\n\ntype ChartType",
    "\ntype ChartType",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove TradeLockerHistoryCandle interface')

replace_once(
    "  const candleCacheRef = useRef<Record<string, CandlestickData[]>>({});\n"
    "  const loadedChartKeyRef = useRef('');\n"
    "  const candleRequestRef = useRef(0);\n",
    "",
)
replace_once(
    "  const [chartRevision, setChartRevision] = useState(0);\n",
    "  const [chartRevision, setChartRevision] = useState(0);\n"
    "  const [chartReady, setChartReady] = useState(false);\n",
)

marker = "  const drawingStorageKeyRef = useRef('');\n"
insert = marker + "\n  const handleCandlesLoaded = useCallback(() => {\n    setChartRevision((revision) => revision + 1);\n  }, []);\n  const {\n    connected: candleConnected,\n    refresh: refreshCandles,\n    mergeLive: mergeLiveCandle,\n    getCachedCandles,\n  } = useCandles({\n    symbol: selectedSymbol,\n    timeframe,\n    seriesRef: candlestickSeriesRef,\n    enabled: chartReady,\n    onLoaded: handleCandlesLoaded,\n    onPrice: setCurrentPrice,\n  });\n\n  useEffect(() => {\n    if (candleConnected) setIsConnected(true);\n  }, [candleConnected]);\n"
replace_once(marker, insert)

replace_once(
    "      const candles = candleCacheRef.current[`${selectedSymbol}:${timeframe}`] || [];",
    "      const candles = getCachedCandles();",
)
replace_once(
    "  }, [magnetDrawing, selectedSymbol, timeframe]);",
    "  }, [getCachedCandles, magnetDrawing]);",
)

text, count = re.subn(
    r"\n  const normalizeHistoryCandle = .*?\n  const fetchBwtsHarmonics",
    "\n  const fetchBwtsHarmonics",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove inline candle normalization/fetch block')

text, count = re.subn(
    r"\n  const loadCandlesForSymbol = useCallback\(async \(.*?\n  const loadTradeLockerInstruments",
    "\n  const loadTradeLockerInstruments",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove loadCandlesForSymbol block')

replace_once(
    "        loadCandlesForSymbol(defaultSymbol, timeframe);\n        loadSymbolData(defaultSymbol);",
    "        loadSymbolData(defaultSymbol);",
)
replace_once(
    "  }, [loadCandlesForSymbol, selectedSymbol, timeframe]);",
    "  }, [selectedSymbol, timeframe]);",
)

replace_once(
    "      chartInitialized.current = true;\n",
    "      chartInitialized.current = true;\n      setChartReady(true);\n",
)
replace_once(
    "        chartInitialized.current = false;\n",
    "        chartInitialized.current = false;\n        setChartReady(false);\n",
)

old_stream = """      ws.onmessage = (event) => {
        if (disposed || loadedChartKeyRef.current !== key) return;
        try {
          const message = JSON.parse(event.data);
          const price = Number(message?.p);
          const tradeTime = Math.floor(Number(message?.T) / 1000);
          if (!Number.isFinite(price) || !Number.isFinite(tradeTime) ||
              !candlestickSeriesRef.current) return;
          const bucketTime = Math.floor(tradeTime / bucketSeconds) * bucketSeconds;
          const cached = candleCacheRef.current[key] || [];
          const previous = cached[cached.length - 1];
          const candle: CandlestickData = previous && Number(previous.time) === bucketTime
            ? {
                ...previous,
                high: Math.max(previous.high, price),
                low: Math.min(previous.low, price),
                close: price,
              }
            : {
                time: bucketTime as UTCTimestamp,
                open: price, high: price, low: price, close: price,
              };
          candlestickSeriesRef.current.update(candle);
          if (previous && Number(previous.time) === bucketTime) {
            cached[cached.length - 1] = candle;
          } else {
            cached.push(candle);
            if (cached.length > 250) cached.shift();
          }
          candleCacheRef.current[key] = cached;
          const now = performance.now();
          if (now - lastUiPriceUpdateRef.current >= 100) {
            lastUiPriceUpdateRef.current = now;
            setCurrentPrice(price);
          }
        } catch (error) {
          console.warn('Invalid Binance market-data event:', error);
        }
      };"""
new_stream = """      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data);
          const price = Number(message?.p);
          const tradeTime = Math.floor(Number(message?.T) / 1000);
          if (!Number.isFinite(price) || !Number.isFinite(tradeTime)) return;
          const bucketTime = Math.floor(tradeTime / bucketSeconds) * bucketSeconds;
          const cached = getCachedCandles();
          const previous = cached[cached.length - 1];
          const candle: CandlestickData = previous && Number(previous.time) === bucketTime
            ? {
                ...previous,
                high: Math.max(previous.high, price),
                low: Math.min(previous.low, price),
                close: price,
              }
            : {
                time: bucketTime as UTCTimestamp,
                open: price, high: price, low: price, close: price,
              };
          mergeLiveCandle(candle);
        } catch (error) {
          console.warn('Invalid Binance market-data event:', error);
        }
      };"""
replace_once(old_stream, new_stream)
replace_once(
    "    const key = `${selectedSymbol}:${timeframe}`;\n    const connect = () => {",
    "    const connect = () => {",
)
replace_once(
    "  }, [isLive, selectedSymbol, timeframe]);",
    "  }, [getCachedCandles, isLive, mergeLiveCandle, selectedSymbol, timeframe]);",
)

replace_once(
    "      if (!document.hidden) loadCandlesForSymbol(selectedSymbol, timeframe, true);",
    "      if (!document.hidden) void refreshCandles(true);",
)
replace_once(
    "  }, [isLive, loadCandlesForSymbol, selectedSymbol, timeframe]);",
    "  }, [isLive, refreshCandles]);",
)

replace_once(
    "    loadCandlesForSymbol(newSymbol, timeframe);\n    \n    // Load new technical analysis",
    "    // Load new technical analysis",
)
text, count = re.subn(
    r"\n  useEffect\(\(\) => \{\n    loadCandlesForSymbol\(selectedSymbol, timeframe\);\n  \}, \[loadCandlesForSymbol, selectedSymbol, timeframe\]\);\n",
    "\n",
    text,
    count=1,
)
if count != 1:
    raise RuntimeError('Could not remove duplicate candle-loading effect')

replace_once(
    "    const candles = (candleCacheRef.current[`${selectedSymbol}:${timeframe}`] || []).slice(-120).map((candle) => ({",
    "    const candles = getCachedCandles().slice(-120).map((candle) => ({",
)
replace_once(
    "  }, [selectedSymbol, timeframe, currentPrice, harmonicPatterns, adrData, trendLines, fibonacciLevels, drawings, cryptoAnalysis]);",
    "  }, [getCachedCandles, selectedSymbol, timeframe, currentPrice, harmonicPatterns, adrData, trendLines, fibonacciLevels, drawings, cryptoAnalysis]);",
)
replace_once(
    "                loadCandlesForSymbol(selectedSymbol, timeframe, true);",
    "                void refreshCandles(true);",
)

# The old throttle ref is no longer needed because live price ownership moved to useCandles.
replace_once("  const lastUiPriceUpdateRef = useRef(0);\n", "")

if text == original:
    raise RuntimeError('Codemod produced no changes')

path.write_text(text)
print('Integrated useCandles into TradingView.tsx')
