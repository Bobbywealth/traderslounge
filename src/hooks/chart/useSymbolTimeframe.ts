/**
 * Hook for managing symbol and timeframe selection.
 * 
 * Handles:
 * - Symbol search and suggestions
 * - Timeframe selection
 * - URL sync
 * - Available symbols list
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

interface SymbolInfo {
  symbol: string;
  name: string;
  exchange: string;
}

interface UseSymbolTimeframeOptions {
  initialSymbol?: string;
  initialTimeframe?: string;
  availableSymbols?: SymbolInfo[];
  onSymbolChange?: (symbol: string) => void;
  onTimeframeChange?: (timeframe: string) => void;
}

interface UseSymbolTimeframeReturn {
  symbol: string;
  timeframe: string;
  searchTerm: string;
  suggestions: SymbolInfo[];
  showSuggestions: boolean;
  setSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: string) => void;
  setSearchTerm: (term: string) => void;
  selectSuggestion: (symbol: SymbolInfo) => void;
  hideSuggestions: () => void;
}

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

const DEFAULT_SYMBOLS: SymbolInfo[] = [
  { symbol: 'BTCUSD', name: 'Bitcoin', exchange: 'BINANCE' },
  { symbol: 'ETHUSD', name: 'Ethereum', exchange: 'BINANCE' },
  { symbol: 'XAUUSD', name: 'Gold', exchange: 'POLYGON' },
  { symbol: 'EURUSD', name: 'EUR/USD', exchange: 'POLYGON' },
  { symbol: 'GBPUSD', name: 'GBP/USD', exchange: 'POLYGON' },
  { symbol: 'USDJPY', name: 'USD/JPY', exchange: 'POLYGON' },
];

export function useSymbolTimeframe({
  initialSymbol = 'BTCUSD',
  initialTimeframe = '1h',
  availableSymbols = DEFAULT_SYMBOLS,
  onSymbolChange,
  onTimeframeChange,
}: UseSymbolTimeframeOptions = {}): UseSymbolTimeframeReturn {
  const [symbol, setSymbolState] = useState(initialSymbol);
  const [timeframe, setTimeframeState] = useState(initialTimeframe);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  // Filter suggestions based on search term
  const suggestions = useMemo(() => {
    if (!searchTerm) return [];
    const term = searchTerm.toLowerCase();
    return availableSymbols.filter(s => 
      s.symbol.toLowerCase().includes(term) ||
      s.name.toLowerCase().includes(term)
    ).slice(0, 10);
  }, [searchTerm, availableSymbols]);
  
  // Set symbol with callbacks
  const setSymbol = useCallback((newSymbol: string) => {
    setSymbolState(newSymbol);
    setSearchTerm('');
    setShowSuggestions(false);
    onSymbolChange?.(newSymbol);
    
    // Update URL
    const url = new URL(window.location.href);
    url.searchParams.set('symbol', newSymbol);
    window.history.replaceState({}, '', url.toString());
  }, [onSymbolChange]);
  
  // Set timeframe with callbacks
  const setTimeframe = useCallback((newTimeframe: string) => {
    setTimeframeState(newTimeframe);
    onTimeframeChange?.(newTimeframe);
    
    // Update URL
    const url = new URL(window.location.href);
    url.searchParams.set('timeframe', newTimeframe);
    window.history.replaceState({}, '', url.toString());
  }, [onTimeframeChange]);
  
  // Select suggestion
  const selectSuggestion = useCallback((suggestion: SymbolInfo) => {
    setSymbol(suggestion.symbol);
  }, [setSymbol]);
  
  // Hide suggestions
  const hideSuggestions = useCallback(() => {
    setShowSuggestions(false);
  }, []);
  
  // Initialize from URL
  useEffect(() => {
    const url = new URL(window.location.href);
    const urlSymbol = url.searchParams.get('symbol');
    const urlTimeframe = url.searchParams.get('timeframe');
    
    if (urlSymbol && urlSymbol !== symbol) {
      setSymbolState(urlSymbol);
    }
    if (urlTimeframe && urlTimeframe !== timeframe) {
      setTimeframeState(urlTimeframe);
    }
  }, []); // Run only once on mount
  
  // Show suggestions when typing
  useEffect(() => {
    setShowSuggestions(searchTerm.length > 0 && suggestions.length > 0);
  }, [searchTerm, suggestions]);
  
  return {
    symbol,
    timeframe,
    searchTerm,
    suggestions,
    showSuggestions,
    setSymbol,
    setTimeframe,
    setSearchTerm,
    selectSuggestion,
    hideSuggestions,
  };
}
