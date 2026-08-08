/**
 * Hook for managing chart drawing tools.
 * 
 * Handles:
 * - Drawing state management
 * - Tool selection
 * - Drawing creation and modification
 * - Undo/redo functionality
 */
import { useCallback, useState } from 'react';

type DrawingTool = 'pan' | 'select' | 'trend' | 'horizontal' | 'sr' | 'rectangle' | 'fib' | 'fib-ext' | 'text';

interface DrawingPoint {
  time: number;
  price: number;
}

interface ManualDrawing {
  id: string;
  type: Exclude<DrawingTool, 'select' | 'pan'>;
  points: DrawingPoint[];
  text?: string;
  color?: string;
  locked?: boolean;
  lineStyle?: 'solid' | 'dashed';
  showPrice?: boolean;
  customLevels?: number[];
}

interface UseDrawingToolsOptions {
  initialDrawings?: ManualDrawing[];
  onDrawingsChange?: (drawings: ManualDrawing[]) => void;
}

interface UseDrawingToolsReturn {
  drawings: ManualDrawing[];
  activeTool: DrawingTool;
  selectedDrawingId: string | null;
  isDrawing: boolean;
  currentPoints: DrawingPoint[];
  setActiveTool: (tool: DrawingTool) => void;
  selectDrawing: (id: string | null) => void;
  startDrawing: (point: DrawingPoint) => void;
  continueDrawing: (point: DrawingPoint) => void;
  finishDrawing: (text?: string) => void;
  cancelDrawing: () => void;
  deleteDrawing: (id: string) => void;
  updateDrawing: (id: string, updates: Partial<ManualDrawing>) => void;
  undo: () => void;
  redo: () => void;
  clearAll: () => void;
}

export function useDrawingTools({
  initialDrawings = [],
  onDrawingsChange,
}: UseDrawingToolsOptions = {}): UseDrawingToolsReturn {
  const [drawings, setDrawings] = useState<ManualDrawing[]>(initialDrawings);
  const [activeTool, setActiveTool] = useState<DrawingTool>('pan');
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [currentPoints, setCurrentPoints] = useState<DrawingPoint[]>([]);
  const [history, setHistory] = useState<ManualDrawing[][]>([initialDrawings]);
  const [historyIndex, setHistoryIndex] = useState(0);
  
  const isDrawing = currentPoints.length > 0 && activeTool !== 'pan' && activeTool !== 'select';
  
  // Save to history
  const saveToHistory = useCallback((newDrawings: ManualDrawing[]) => {
    setHistory(prev => [...prev.slice(0, historyIndex + 1), newDrawings]);
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);
  
  // Start drawing
  const startDrawing = useCallback((point: DrawingPoint) => {
    if (activeTool === 'pan' || activeTool === 'select') return;
    setCurrentPoints([point]);
  }, [activeTool]);
  
  // Continue drawing
  const continueDrawing = useCallback((point: DrawingPoint) => {
    if (!isDrawing) return;
    setCurrentPoints(prev => {
      if (prev.length >= 2) return [prev[0], point];
      return [...prev, point];
    });
  }, [isDrawing]);
  
  // Finish drawing
  const finishDrawing = useCallback((text?: string) => {
    if (!isDrawing || currentPoints.length < 1) return;
    
    const newDrawing: ManualDrawing = {
      id: `drawing-${Date.now()}`,
      type: activeTool as Exclude<DrawingTool, 'select' | 'pan'>,
      points: currentPoints,
      text,
      color: getDefaultColor(activeTool),
      locked: false,
      lineStyle: 'solid',
      showPrice: true,
    };
    
    const newDrawings = [...drawings, newDrawing];
    setDrawings(newDrawings);
    saveToHistory(newDrawings);
    setCurrentPoints([]);
    onDrawingsChange?.(newDrawings);
  }, [isDrawing, currentPoints, activeTool, drawings, saveToHistory, onDrawingsChange]);
  
  // Cancel drawing
  const cancelDrawing = useCallback(() => {
    setCurrentPoints([]);
  }, []);
  
  // Delete drawing
  const deleteDrawing = useCallback((id: string) => {
    const newDrawings = drawings.filter(d => d.id !== id);
    setDrawings(newDrawings);
    saveToHistory(newDrawings);
    onDrawingsChange?.(newDrawings);
  }, [drawings, saveToHistory, onDrawingsChange]);
  
  // Update drawing
  const updateDrawing = useCallback((id: string, updates: Partial<ManualDrawing>) => {
    const newDrawings = drawings.map(d => 
      d.id === id ? { ...d, ...updates } : d
    );
    setDrawings(newDrawings);
    onDrawingsChange?.(newDrawings);
  }, [drawings, onDrawingsChange]);
  
  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setDrawings(history[historyIndex - 1]);
      onDrawingsChange?.(history[historyIndex - 1]);
    }
  }, [historyIndex, history, onDrawingsChange]);
  
  // Redo
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setDrawings(history[historyIndex + 1]);
      onDrawingsChange?.(history[historyIndex + 1]);
    }
  }, [historyIndex, history, onDrawingsChange]);
  
  // Clear all
  const clearAll = useCallback(() => {
    setDrawings([]);
    saveToHistory([]);
    onDrawingsChange?.([]);
  }, [saveToHistory, onDrawingsChange]);
  
  return {
    drawings,
    activeTool,
    selectedDrawingId,
    isDrawing,
    currentPoints,
    setActiveTool,
    selectDrawing: setSelectedDrawingId,
    startDrawing,
    continueDrawing,
    finishDrawing,
    cancelDrawing,
    deleteDrawing,
    updateDrawing,
    undo,
    redo,
    clearAll,
  };
}

function getDefaultColor(tool: DrawingTool): string {
  switch (tool) {
    case 'trend':
      return '#2962FF';
    case 'horizontal':
    case 'sr':
      return '#FF6B35';
    case 'rectangle':
      return '#7B61FF';
    case 'fib':
    case 'fib-ext':
      return '#00C853';
    case 'text':
      return '#FFFFFF';
    default:
      return '#2962FF';
  }
}
