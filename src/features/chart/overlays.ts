import { useEffect, useRef, type DependencyList, type RefObject } from 'react';
import { LineSeries, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { HarmonicPattern, TrendLine } from '../../services/liveDataService';
import type { CryptoAnalysis } from '../../services/bwtsApi';
import { CHART_COLORS } from './constants';

export interface ChartAdr {
  pair: string;
  period: number;
  day_time: number;
  adr: number;
  day_open: number;
  day_high: number;
  day_low: number;
  current_range: number;
  percent_used: number;
  adr_high: number;
  adr_low: number;
  near_adr_high: boolean;
  near_adr_low: boolean;
  exhausted: boolean;
}

/** Loose server shapes: `CryptoAnalysis.zones` is an untyped record upstream. */
export interface SupportResistanceZone {
  type?: string;
  level?: number | string;
  strength?: string;
  touches?: number;
  distance_atr?: number;
}

export interface SetupZone {
  direction?: string;
  low?: number | string;
  high?: number | string;
  center?: number | string;
  score?: number;
  actionable?: boolean;
  conflicting_with_harmonic?: boolean;
  reasons?: string[];
}

export interface PlanGating {
  v2Score: number;
  planDirection: string;
  timingStatus: string;
  calendarStatus: string;
  planEligible: boolean;
  hardBlocked: boolean;
  /** All deterministic gates are clear and the score is above threshold. */
  actionable: boolean;
  /** Gates are clear regardless of the V2 score threshold. */
  ready: boolean;
}

/**
 * One shared computation of the BWTS trade-plan gates. Previously this logic
 * was duplicated in four places with slight risks of drift.
 */
export function getPlanGating(analysis: CryptoAnalysis | null): PlanGating {
  const plan = analysis?.trade_plan;
  const v2Score = Number(analysis?.total_score || 0);
  const planDirection = String(plan?.direction || 'NEUTRAL').toUpperCase();
  const timingStatus = String(plan?.timing_status || analysis?.trade_timing?.status || 'WAIT').toUpperCase();
  const calendarStatus = String(plan?.calendar_status || analysis?.economic_calendar?.status || '').toUpperCase();
  const planEligible = Boolean(plan?.eligible);
  const hardBlocked = ['BLOCKED', 'POST_NEWS', 'UNAVAILABLE'].includes(calendarStatus);
  const ready = planEligible && timingStatus === 'READY' && !hardBlocked;
  return {
    v2Score,
    planDirection,
    timingStatus,
    calendarStatus,
    planEligible,
    hardBlocked,
    ready,
    actionable: ready && v2Score >= 60,
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const svgElement = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  textContent?: string,
): SVGElementTagNameMap[K] => {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  if (textContent != null) element.textContent = textContent;
  return element;
};

/**
 * Manages a group of helper line series: removes the previous group and lets
 * the builder add fresh series whenever the deps change.
 */
function useLineSeriesGroup(
  chartRef: RefObject<IChartApi | null>,
  build: (chart: IChartApi, register: (series: ISeriesApi<'Line'>) => void) => void,
  deps: DependencyList,
) {
  const seriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const series of seriesRef.current) {
      try { chart.removeSeries(series); } catch { /* chart was rebuilt */ }
    }
    seriesRef.current = [];
    build(chart, (series) => seriesRef.current.push(series));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Renders an absolutely-positioned SVG overlay above the chart canvases and
 * re-renders it on pan, zoom, and window resize. `draw` populates a fresh
 * <svg> and returns whether it should be attached.
 */
function useChartSvgOverlay(
  chartRef: RefObject<IChartApi | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  attribute: string,
  draw: (svg: SVGSVGElement, container: HTMLDivElement) => boolean,
  deps: DependencyList,
) {
  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;
    const removeOverlay = () => container.querySelector(`[${attribute}]`)?.remove();

    const renderOverlay = () => {
      removeOverlay();
      const svg = svgElement('svg', {
        [attribute]: 'true',
        width: container.clientWidth,
        height: container.clientHeight,
      });
      svg.style.position = 'absolute';
      svg.style.inset = '0';
      svg.style.zIndex = '10';
      svg.style.pointerEvents = 'none';
      svg.style.overflow = 'visible';
      if (draw(svg, container)) container.appendChild(svg);
    };

    const deferredRender = () => requestAnimationFrame(renderOverlay);
    deferredRender();
    chart.timeScale().subscribeVisibleTimeRangeChange(deferredRender);
    window.addEventListener('resize', deferredRender);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(deferredRender);
      window.removeEventListener('resize', deferredRender);
      removeOverlay();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Dashed X-A-B-C-D zigzag drawn as a native chart series. */
export function useHarmonicPatternSeries(
  chartRef: RefObject<IChartApi | null>,
  patterns: HarmonicPattern[],
  show: boolean,
  chartRevision: number,
) {
  useLineSeriesGroup(chartRef, (chart, register) => {
    if (!show) return;
    for (const pattern of patterns) {
      if (pattern.status !== 'completed') continue;
      const color = pattern.direction === 'bullish' ? CHART_COLORS.candleUp : CHART_COLORS.bearish;
      const patternSeries = chart.addSeries(LineSeries, {
        color,
        lineWidth: 3,
        lineStyle: LineStyle.Dashed,
        title: `${pattern.direction.toUpperCase()} ${pattern.type}`,
      });
      register(patternSeries);
      const labels = ['X', 'A', 'B', 'C', 'D'] as const;
      patternSeries.setData(labels.map((label) => ({
        time: Math.floor(pattern.points[label].time.getTime() / 1000) as UTCTimestamp,
        value: pattern.points[label].price,
      })));
      // Keep the user's current zoom and pan. Pattern overlays must never
      // force the visible range when scans refresh.
    }
  }, [patterns, show, chartRevision]);
}

/** Prominent filled XABCD geometry with point labels and the PRZ box. */
export function useHarmonicSvgOverlay(
  chartRef: RefObject<IChartApi | null>,
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  patterns: HarmonicPattern[],
  show: boolean,
  analysis: CryptoAnalysis | null,
  chartRevision: number,
) {
  useChartSvgOverlay(chartRef, containerRef, 'data-harmonic-overlay', (svg, container) => {
    const chart = chartRef.current;
    const priceSeries = seriesRef.current;
    if (!chart || !priceSeries || !show || patterns.length === 0) return false;

    // Dim the harmonic PRZ to "REFERENCE" when the deterministic setup is
    // not actionable, so the chart does not look like an active trade.
    const { actionable } = getPlanGating(analysis);
    const fillOpacity = actionable ? 0.22 : 0.08;
    const przFillOpacity = actionable ? 0.18 : 0.06;
    const przStrokeOpacity = actionable ? 1 : 0.5;
    const referenceTag = actionable ? '' : ' (REFERENCE)';
    svg.style.opacity = String(actionable ? 1 : 0.45);

    for (const pattern of patterns) {
      const labels = ['X', 'A', 'B', 'C', 'D'] as const;
      const coords = labels.map((label) => {
        const point = pattern.points[label];
        return {
          label,
          price: point.price,
          x: chart.timeScale().timeToCoordinate(Math.floor(point.time.getTime() / 1000) as UTCTimestamp),
          y: priceSeries.priceToCoordinate(point.price),
        };
      });
      if (coords.some((point) => point.x == null || point.y == null)) continue;
      const color = pattern.direction === 'bullish' ? CHART_COLORS.bullish : CHART_COLORS.bearish;
      const xy = (indexes: number[]) => indexes
        .map((index) => `${coords[index].x},${coords[index].y}`)
        .join(' ');

      // Two shaded triangles make the harmonic structure impossible to miss.
      for (const indexes of [[0, 1, 2], [2, 3, 4]]) {
        svg.appendChild(svgElement('polygon', {
          points: xy(indexes),
          fill: color,
          'fill-opacity': fillOpacity,
          stroke: color,
          'stroke-opacity': 0.55,
          'stroke-width': 1.5,
        }));
      }

      svg.appendChild(svgElement('polyline', {
        points: xy([0, 1, 2, 3, 4]),
        fill: 'none',
        stroke: color,
        'stroke-width': 4,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }));

      for (const point of coords) {
        svg.appendChild(svgElement('circle', {
          cx: Number(point.x),
          cy: Number(point.y),
          r: 6,
          fill: color,
          stroke: '#ffffff',
          'stroke-width': 2,
        }));
        svg.appendChild(svgElement('text', {
          x: Number(point.x) + 9,
          y: Number(point.y) - 9,
          fill: '#ffffff',
          'font-size': 13,
          'font-weight': 700,
          'paint-order': 'stroke',
          stroke: CHART_COLORS.labelStroke,
          'stroke-width': 4,
          'stroke-linejoin': 'round',
        }, `${point.label} (${point.price.toFixed(2)})`));
      }

      const d = coords[4];
      const yLow = priceSeries.priceToCoordinate(pattern.prz.min);
      const yHigh = priceSeries.priceToCoordinate(pattern.prz.max);
      if (yLow != null && yHigh != null && d.x != null) {
        const top = Math.min(yLow, yHigh);
        const boxX = Math.max(0, Number(d.x) - 8);
        svg.appendChild(svgElement('rect', {
          x: boxX,
          y: top,
          width: Math.max(60, Math.min(140, container.clientWidth - boxX)),
          height: Math.max(8, Math.abs(yLow - yHigh)),
          fill: color,
          'fill-opacity': przFillOpacity,
          stroke: color,
          'stroke-opacity': przStrokeOpacity,
          'stroke-width': 2,
          'stroke-dasharray': '7 5',
        }));
        svg.appendChild(svgElement('text', {
          x: boxX + 8,
          y: top - 7,
          fill: color,
          'font-size': 13,
          'font-weight': 800,
        }, `${pattern.type} PRZ ${pattern.prz.min.toFixed(2)}–${pattern.prz.max.toFixed(2)}${referenceTag}`));
      }
    }
    return true;
  }, [chartRevision, patterns, show, analysis]);
}

/** ADR(14) high, low, and day-open reference lines. */
export function useAdrLevelSeries(
  chartRef: RefObject<IChartApi | null>,
  adrData: ChartAdr | null,
  chartRevision: number,
) {
  useLineSeriesGroup(chartRef, (chart, register) => {
    if (!adrData) return;
    const start = adrData.day_time as UTCTimestamp;
    const end = Math.max(Math.floor(Date.now() / 1000), adrData.day_time + 60) as UTCTimestamp;
    const levels = [
      { title: 'ADR High', value: adrData.adr_high, color: CHART_COLORS.adrHigh, style: LineStyle.Dashed },
      { title: 'Day Open', value: adrData.day_open, color: CHART_COLORS.dayOpen, style: LineStyle.Dotted },
      { title: 'ADR Low', value: adrData.adr_low, color: CHART_COLORS.adrLow, style: LineStyle.Dashed },
    ] as const;
    for (const level of levels) {
      const series = chart.addSeries(LineSeries, {
        color: level.color,
        lineWidth: 2,
        lineStyle: level.style,
        title: `${level.title} ${level.value.toFixed(2)}`,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      series.setData([{ time: start, value: level.value }, { time: end, value: level.value }]);
      register(series);
    }
  }, [adrData, chartRevision]);
}

/** Detected support/resistance trendlines. */
export function useTrendLineSeries(
  chartRef: RefObject<IChartApi | null>,
  trendLines: TrendLine[],
  show: boolean,
  chartRevision: number,
) {
  useLineSeriesGroup(chartRef, (chart, register) => {
    if (!show) return;
    for (const trendLine of trendLines) {
      if (!trendLine.isActive || trendLine.points.length < 2) continue;
      const series = chart.addSeries(LineSeries, {
        color: trendLine.type === 'support' ? CHART_COLORS.trendSupport : CHART_COLORS.trendResistance,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        title: `${trendLine.type} Line`,
      });
      try {
        series.setData(trendLine.points.map((point) => ({
          time: Math.floor(point.time.getTime() / 1000) as UTCTimestamp,
          value: point.price,
        })));
        register(series);
      } catch (error) {
        console.warn('Failed to draw trendline:', error);
        try { chart.removeSeries(series); } catch { /* already removed */ }
      }
    }
  }, [trendLines, show, chartRevision]);
}

/**
 * V2 Fibonacci plus support/resistance from the same analysis used by the
 * dashboard. Only shows the strongest zones close to current price.
 */
export function useAnalysisLevelSeries(
  chartRef: RefObject<IChartApi | null>,
  analysis: CryptoAnalysis | null,
  showSupportResistance: boolean,
  showFibonacci: boolean,
  currentPrice: number,
  chartRevision: number,
) {
  useLineSeriesGroup(chartRef, (chart, register) => {
    if (!analysis) return;
    const visible = chart.timeScale().getVisibleRange();
    const now = Math.floor(Date.now() / 1000);
    const start = (typeof visible?.from === 'number' ? visible.from : now - 7 * 86400) as UTCTimestamp;
    const end = (typeof visible?.to === 'number' ? visible.to : now + 86400) as UTCTimestamp;
    const levels: { title: string; value: number; color: string; style: LineStyle }[] = [];

    if (showSupportResistance) {
      const detailed: SupportResistanceZone[] = analysis.zones.support_resistance || [];
      if (detailed.length) {
        // Sort by strength first (strong first), then by distance (closest
        // first); show only the top 2 of each type within 5*ATR of price.
        const atrForFilter = Number(analysis.indicators.atr || 0) * 5;
        ['support', 'resistance'].forEach((type) => {
          const zonesOfType = detailed
            .filter((zone) => zone.type === type)
            .filter((zone) => !atrForFilter || Math.abs(Number(zone.level) - currentPrice) <= atrForFilter)
            .sort((a, b) => {
              const strengthOrder = { strong: 0, moderate: 1, weak: 2 };
              const aStr = strengthOrder[a.strength as keyof typeof strengthOrder] ?? 2;
              const bStr = strengthOrder[b.strength as keyof typeof strengthOrder] ?? 2;
              if (aStr !== bStr) return aStr - bStr;
              return (a.distance_atr || 99) - (b.distance_atr || 99);
            })
            .slice(0, 2);
          zonesOfType.forEach((zone, index) => {
            levels.push({
              title: `${type === 'support' ? 'S' : 'R'}${index + 1} ${zone.strength === 'strong' ? '◆' : '◇'} ${zone.touches}×`,
              value: Number(zone.level),
              color: type === 'support' ? CHART_COLORS.support : CHART_COLORS.resistance,
              style: zone.strength === 'strong' ? LineStyle.Solid : LineStyle.Dashed,
            });
          });
        });
      } else {
        // Fallback: only show zones within 3*ATR of current price.
        const atrForFilter = Number(analysis.indicators.atr || 0) * 3;
        (analysis.zones.support || [])
          .filter((value: number) => !atrForFilter || Math.abs(value - currentPrice) <= atrForFilter)
          .slice(0, 2)
          .forEach((value: number, index: number) => levels.push({
            title: `S${index + 1}`, value, color: CHART_COLORS.support, style: LineStyle.Dashed,
          }));
        (analysis.zones.resistance || [])
          .filter((value: number) => !atrForFilter || Math.abs(value - currentPrice) <= atrForFilter)
          .slice(0, 2)
          .forEach((value: number, index: number) => levels.push({
            title: `R${index + 1}`, value, color: CHART_COLORS.resistance, style: LineStyle.Dashed,
          }));
      }
    }

    if (showFibonacci) {
      const fibData = analysis.zones.fibonacci || {};
      const confluenceRatios = new Set(
        ((fibData.sr_confluence || []) as Array<{ ratio?: string | number }>).map((item) => String(item.ratio)),
      );
      const atrDistance = Number(analysis.indicators.atr || 0) * 4;
      // Only show KEY fibonacci levels: standard 0.382, 0.5, 0.618, 0.786.
      const keyRatios = ['0.382', '0.5', '0.618', '0.786'];
      Object.entries(fibData.levels || {})
        .filter(([ratio]) => keyRatios.includes(String(ratio)))
        .filter(([, value]) => !atrDistance || Math.abs(Number(value) - currentPrice) <= atrDistance)
        .forEach(([ratio, value]) => {
          levels.push({
            title: `Fib ${ratio}${confluenceRatios.has(ratio) ? ' ★' : ''}`,
            value: Number(value),
            color: ratio === '0.618'
              ? CHART_COLORS.fibGolden
              : confluenceRatios.has(ratio) ? CHART_COLORS.fibConfluence : CHART_COLORS.fib,
            style: LineStyle.Dotted,
          });
        });
    }

    levels.filter((level) => Number.isFinite(level.value)).forEach((level) => {
      const showAxisLabel = /^[SR]\d/.test(level.title) || level.title.startsWith('Fib 0.618');
      const series = chart.addSeries(LineSeries, {
        color: level.color,
        lineWidth: 1,
        lineStyle: level.style,
        title: level.title,
        lastValueVisible: showAxisLabel,
        priceLineVisible: false,
      });
      series.setData([{ time: start, value: level.value }, { time: end, value: level.value }]);
      register(series);
    });
  }, [analysis, showFibonacci, showSupportResistance, chartRevision, currentPrice]);
}

/**
 * Deterministic possible-setup overlay. It visualizes the BWTS trade plan,
 * but never turns a blocked or WAIT plan into an actionable signal.
 */
export function useSetupZoneOverlay(
  chartRef: RefObject<IChartApi | null>,
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  analysis: CryptoAnalysis | null,
  show: boolean,
  chartRevision: number,
  currentPrice: number,
) {
  useChartSvgOverlay(chartRef, containerRef, 'data-setup-overlay', (svg, container) => {
    const priceSeries = seriesRef.current;
    const plan = analysis?.trade_plan;
    if (!priceSeries || !show || !analysis || !plan || plan.direction === 'NEUTRAL' || plan.entry == null) return false;
    const entry = Number(plan.entry);
    if (!Number.isFinite(entry)) return false;
    const atr = Number(plan.atr || analysis.indicators?.atr || 0);
    const halfBand = Math.max(atr > 0 ? atr * 0.2 : 0, Math.abs(entry) * 0.0005);
    const yEntryLow = priceSeries.priceToCoordinate(entry - halfBand);
    const yEntryHigh = priceSeries.priceToCoordinate(entry + halfBand);
    if (yEntryLow == null || yEntryHigh == null) return false;

    const { ready, hardBlocked, timingStatus } = getPlanGating(analysis);
    const directionColor = plan.direction === 'BUY' ? CHART_COLORS.bullish : CHART_COLORS.bearish;
    const statusColor = ready ? directionColor : CHART_COLORS.warning;
    const status = ready ? 'READY' : hardBlocked ? 'BLOCKED' : timingStatus;
    svg.style.zIndex = '11';

    svg.appendChild(svgElement('rect', {
      x: 0,
      y: Math.min(yEntryLow, yEntryHigh),
      width: container.clientWidth,
      height: Math.max(8, Math.abs(yEntryLow - yEntryHigh)),
      fill: directionColor,
      'fill-opacity': ready ? 0.16 : 0.07,
      stroke: statusColor,
      'stroke-width': 2,
      'stroke-dasharray': ready ? 'none' : '7 5',
    }));

    const addLine = (price: number | null | undefined, color: string, label: string, dash = '7 5') => {
      if (price == null || !Number.isFinite(Number(price))) return;
      const y = priceSeries.priceToCoordinate(Number(price));
      if (y == null) return;
      svg.appendChild(svgElement('line', {
        x1: 0,
        x2: container.clientWidth,
        y1: y,
        y2: y,
        stroke: color,
        'stroke-width': 2,
        'stroke-dasharray': dash,
        'stroke-opacity': ready ? 0.9 : 0.55,
      }));
      svg.appendChild(svgElement('text', {
        x: 10,
        y: Math.max(14, Number(y) - 5),
        fill: color,
        'font-size': 11,
        'font-weight': 800,
        'paint-order': 'stroke',
        stroke: CHART_COLORS.overlayLabelStroke,
        'stroke-width': 4,
      }, `${label} ${Number(price).toFixed(2)}`));
    };
    addLine(entry, statusColor, `${plan.direction} ENTRY`, 'none');
    addLine(plan.stop ?? plan.invalidation, CHART_COLORS.invalidation, 'INVALIDATION');
    plan.targets?.slice(0, 3).forEach((target, index) => (
      addLine(target.price, CHART_COLORS.target, target.label || `TP${index + 1}`)
    ));

    svg.appendChild(svgElement('text', {
      x: 10,
      y: Math.max(16, Math.min(yEntryLow, yEntryHigh) - 8),
      fill: statusColor,
      'font-size': 12,
      'font-weight': 900,
      'paint-order': 'stroke',
      stroke: CHART_COLORS.overlayLabelStroke,
      'stroke-width': 4,
    }, `${plan.direction} SETUP ZONE · ${status}`));
    return true;
  }, [analysis, show, chartRevision, currentPrice]);
}

/**
 * When no directional trade plan is eligible, show conditional areas from
 * deterministic support/resistance so the chart still explains where a
 * future buy or sell setup could form.
 */
export function useConditionalSetupOverlay(
  chartRef: RefObject<IChartApi | null>,
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  analysis: CryptoAnalysis | null,
  show: boolean,
  chartRevision: number,
  currentPrice: number,
) {
  useChartSvgOverlay(chartRef, containerRef, 'data-conditional-setup-overlay', (svg, container) => {
    const priceSeries = seriesRef.current;
    const plan = analysis?.trade_plan;
    // Do not paint historical-looking zones while the final gated plan is neutral.
    if (!priceSeries || !show || !analysis || !plan || plan.direction === 'NEUTRAL' || plan.entry == null) return false;
    const detailed: SetupZone[] = Array.isArray(analysis.zones?.setup_zones) ? analysis.zones.setup_zones : [];
    const zones = ['BUY', 'SELL'].flatMap((direction) => (
      detailed.filter((zone) => zone.direction === direction).slice(0, 1)
    ));
    if (!zones.length) return false;
    svg.style.zIndex = '11';

    zones.forEach((zone) => {
      const bullish = zone.direction === 'BUY';
      const color = bullish ? CHART_COLORS.bullish : CHART_COLORS.bearish;
      const low = priceSeries.priceToCoordinate(Number(zone.low));
      const high = priceSeries.priceToCoordinate(Number(zone.high));
      if (low == null || high == null) return;
      svg.appendChild(svgElement('rect', {
        x: 0,
        y: Math.min(low, high),
        width: container.clientWidth,
        height: Math.max(10, Math.abs(low - high)),
        fill: color,
        'fill-opacity': 0.08,
        stroke: color,
        'stroke-opacity': 0.7,
        'stroke-width': 2,
        'stroke-dasharray': '7 5',
      }));
      svg.appendChild(svgElement('text', {
        x: 10,
        y: Math.max(16, Math.min(low, high) - 7),
        fill: color,
        'font-size': 12,
        'font-weight': 900,
        'paint-order': 'stroke',
        stroke: CHART_COLORS.overlayLabelStroke,
        'stroke-width': 4,
      }, `${bullish ? 'BUY' : 'SELL'} AREA ${zone.score}/100`));
    });
    return true;
  }, [analysis, show, chartRevision, currentPrice]);
}
