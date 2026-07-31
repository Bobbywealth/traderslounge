import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import type { CandlestickData } from './chartData';

export type DrawingTool = 'pan' | 'select' | 'trend' | 'horizontal' | 'sr' | 'rectangle' | 'fib' | 'text';
export interface DrawingPoint {
  time: number;
  price: number;
}
export interface ManualDrawing {
  id: string;
  type: Exclude<DrawingTool, 'select' | 'pan'>;
  points: DrawingPoint[];
  text?: string;
  color?: string;
  locked?: boolean;
  lineStyle?: 'solid' | 'dashed';
  showPrice?: boolean;
}

const UNDO_LIMIT = 40;
const PERSIST_DEBOUNCE_MS = 250;

export interface UseDrawingsOptions {
  symbol: string;
  timeframe: string;
  chartRef: RefObject<IChartApi | null>;
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Candles for the active symbol/timeframe, used by the OHLC magnet. */
  getCandles: () => CandlestickData[];
  /** Time/price offset applied when duplicating a drawing. */
  getDuplicateShift: () => { time: number; price: number };
  /** Bumped when the chart instance is (re)created, to re-subscribe pan/zoom redraws. */
  chartRevision: number;
}

export function useDrawings({
  symbol,
  timeframe,
  chartRef,
  seriesRef,
  containerRef,
  getCandles,
  getDuplicateShift,
  chartRevision,
}: UseDrawingsOptions) {
  const storageKey = `confluencex:drawings:${symbol}:${timeframe}`;
  const [drawings, setDrawings] = useState<ManualDrawing[]>([]);
  const [draftDrawing, setDraftDrawing] = useState<ManualDrawing | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>('pan');
  const [drawingColor, setDrawingColor] = useState('#22d3ee');
  const [magnetDrawing, setMagnetDrawing] = useState(true);
  const [drawingRevision, setDrawingRevision] = useState(0);
  const undoRef = useRef<ManualDrawing[][]>([]);
  const pendingWriteRef = useRef<{ key: string; drawings: ManualDrawing[] } | null>(null);
  const skipPersistRef = useRef(true);

  const flushPendingWrite = useCallback(() => {
    const pending = pendingWriteRef.current;
    if (!pending) return;
    pendingWriteRef.current = null;
    try {
      localStorage.setItem(pending.key, JSON.stringify(pending.drawings));
    } catch {
      // Storage full or unavailable; drawings stay in memory.
    }
  }, []);

  // Load persisted drawings whenever the symbol/timeframe changes, saving any
  // pending edits for the previous key first.
  useEffect(() => {
    flushPendingWrite();
    skipPersistRef.current = true;
    try {
      setDrawings(JSON.parse(localStorage.getItem(storageKey) || '[]'));
    } catch {
      setDrawings([]);
    }
    setDraftDrawing(null);
    setSelectedDrawingId(null);
    undoRef.current = [];
  }, [storageKey, flushPendingWrite]);

  // Persist edits, debounced so pointer drags don't write on every move.
  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    pendingWriteRef.current = { key: storageKey, drawings };
    const timer = window.setTimeout(flushPendingWrite, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [drawings, storageKey, flushPendingWrite]);

  useEffect(() => () => flushPendingWrite(), [flushPendingWrite]);

  // Redraw the SVG layer when the user pans or zooms the chart.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const redraw = () => setDrawingRevision((value) => value + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    return () => chart.timeScale().unsubscribeVisibleTimeRangeChange(redraw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartRevision]);

  const saveDrawingChange = useCallback((next: ManualDrawing[]) => {
    undoRef.current.push(drawings);
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
    setDrawings(next);
  }, [drawings]);

  const drawingPointFromClient = useCallback((clientX: number, clientY: number): DrawingPoint | null => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = containerRef.current;
    if (!chart || !series || !container) return null;
    const rect = container.getBoundingClientRect();
    const time = chart.timeScale().coordinateToTime(clientX - rect.left);
    const price = series.coordinateToPrice(clientY - rect.top);
    if (time == null || price == null || typeof time !== 'number') return null;

    let point: DrawingPoint = { time: Number(time), price: Number(price) };
    if (magnetDrawing) {
      const candles = getCandles();
      const candle = candles.reduce<CandlestickData | null>((nearest, item) => (
        !nearest || Math.abs(Number(item.time) - point.time) < Math.abs(Number(nearest.time) - point.time)
          ? item
          : nearest
      ), null);
      if (candle) {
        const prices = [candle.open, candle.high, candle.low, candle.close];
        point = {
          time: Number(candle.time),
          price: prices.reduce((nearest, value) => (
            Math.abs(value - point.price) < Math.abs(nearest - point.price) ? value : nearest
          ), prices[0]),
        };
      }
    }
    return point;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [magnetDrawing, getCandles]);

  const drawingPointFromEvent = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => drawingPointFromClient(event.clientX, event.clientY),
    [drawingPointFromClient],
  );

  const handleDrawingPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (drawingTool === 'select' || drawingTool === 'pan') return;
    const point = drawingPointFromEvent(event);
    if (!point) return;

    if (drawingTool === 'horizontal' || drawingTool === 'sr') {
      saveDrawingChange([...drawings, {
        id: crypto.randomUUID(),
        type: drawingTool,
        points: [point],
        color: drawingColor,
        lineStyle: drawingTool === 'sr' ? 'dashed' : 'solid',
        showPrice: true,
      }]);
      return;
    }
    if (drawingTool === 'text') {
      const text = window.prompt('Annotation text');
      if (text?.trim()) {
        saveDrawingChange([...drawings, {
          id: crypto.randomUUID(),
          type: 'text',
          points: [point],
          text: text.trim(),
          color: drawingColor,
          showPrice: false,
        }]);
      }
      return;
    }
    setDraftDrawing({
      id: crypto.randomUUID(),
      type: drawingTool,
      points: [point, point],
      color: drawingColor,
      lineStyle: drawingTool === 'fib' ? 'dashed' : 'solid',
      showPrice: true,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [drawingTool, drawingPointFromEvent, drawings, saveDrawingChange, drawingColor]);

  const handleDrawingPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (!draftDrawing) return;
    const point = drawingPointFromEvent(event);
    if (!point) return;
    setDraftDrawing({ ...draftDrawing, points: [draftDrawing.points[0], point] });
  }, [draftDrawing, drawingPointFromEvent]);

  const handleDrawingPointerUp = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (!draftDrawing) return;
    const point = drawingPointFromEvent(event) || draftDrawing.points[1];
    const next = { ...draftDrawing, points: [draftDrawing.points[0], point] };
    const [start, end] = next.points;
    if (Math.abs(start.time - end.time) > 0 || Math.abs(start.price - end.price) > 0) {
      saveDrawingChange([...drawings, next]);
    }
    setDraftDrawing(null);
  }, [draftDrawing, drawingPointFromEvent, drawings, saveDrawingChange]);

  const undoDrawing = useCallback(() => {
    const previous = undoRef.current.pop();
    if (previous) {
      setDrawings(previous);
      setSelectedDrawingId(null);
    }
  }, []);

  const selectedDrawing = drawings.find((drawing) => drawing.id === selectedDrawingId) || null;

  const updateSelectedDrawing = useCallback((changes: Partial<ManualDrawing>) => {
    if (!selectedDrawingId) return;
    saveDrawingChange(drawings.map((drawing) => (
      drawing.id === selectedDrawingId ? { ...drawing, ...changes } : drawing
    )));
  }, [selectedDrawingId, drawings, saveDrawingChange]);

  const deleteSelectedDrawing = useCallback(() => {
    if (selectedDrawingId && !selectedDrawing?.locked) {
      saveDrawingChange(drawings.filter((drawing) => drawing.id !== selectedDrawingId));
      setSelectedDrawingId(null);
    }
  }, [selectedDrawingId, selectedDrawing, drawings, saveDrawingChange]);

  const duplicateSelectedDrawing = useCallback(() => {
    if (!selectedDrawing) return;
    const shift = getDuplicateShift();
    const copy: ManualDrawing = {
      ...selectedDrawing,
      id: crypto.randomUUID(),
      locked: false,
      points: selectedDrawing.points.map((point) => ({
        time: point.time + shift.time,
        price: point.price + shift.price,
      })),
    };
    saveDrawingChange([...drawings, copy]);
    setSelectedDrawingId(copy.id);
  }, [selectedDrawing, drawings, saveDrawingChange, getDuplicateShift]);

  const clearDrawings = useCallback(() => {
    if (drawings.length && window.confirm('Clear drawings for this symbol and timeframe?')) {
      saveDrawingChange([]);
      setSelectedDrawingId(null);
    }
  }, [drawings, saveDrawingChange]);

  const handleAnchorPointerDown = useCallback((
    event: ReactPointerEvent<SVGCircleElement>,
    drawing: ManualDrawing,
  ) => {
    event.stopPropagation();
    if (drawing.locked) return;
    undoRef.current.push(drawings);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [drawings]);

  const handleAnchorPointerMove = useCallback((
    event: ReactPointerEvent<SVGCircleElement>,
    drawingId: string,
    pointIndex: number,
  ) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = drawingPointFromClient(event.clientX, event.clientY);
    if (!point) return;
    setDrawings((current) => current.map((drawing) => (
      drawing.id === drawingId
        ? {
            ...drawing,
            points: drawing.points.map((existing, index) => (index === pointIndex ? point : existing)),
          }
        : drawing
    )));
  }, [drawingPointFromClient]);

  const handleAnchorPointerUp = useCallback((event: ReactPointerEvent<SVGCircleElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const drawingCoordinates = useCallback((drawing: ManualDrawing) => {
    const series = seriesRef.current;
    return drawing.points.map((point) => ({
      x: chartRef.current?.timeScale().timeToCoordinate(point.time as UTCTimestamp) ?? null,
      y: series?.priceToCoordinate(point.price) ?? null,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    drawings,
    draftDrawing,
    selectedDrawing,
    selectedDrawingId,
    setSelectedDrawingId,
    drawingTool,
    setDrawingTool,
    drawingColor,
    setDrawingColor,
    magnetDrawing,
    setMagnetDrawing,
    drawingRevision,
    canUndo: undoRef.current.length > 0,
    saveDrawingChange,
    handleDrawingPointerDown,
    handleDrawingPointerMove,
    handleDrawingPointerUp,
    handleAnchorPointerDown,
    handleAnchorPointerMove,
    handleAnchorPointerUp,
    undoDrawing,
    updateSelectedDrawing,
    deleteSelectedDrawing,
    duplicateSelectedDrawing,
    clearDrawings,
    drawingCoordinates,
  };
}
