/**
 * EMA Settings Panel
 * UI for configuring EMA indicators with per-EMA customization.
 */
import React, { useState, useCallback } from 'react';
import { Settings, RotateCcw, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';
import type { EmaConfig, PriceSource } from '../indicators/ema/types';
import { DEFAULT_EMA_CONFIGS } from '../indicators/ema/emaCalculator';

interface EmaSettingsPanelProps {
  configs: EmaConfig[];
  onChange: (configs: EmaConfig[]) => void;
  onReset: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

const PRICE_SOURCES: { value: PriceSource; label: string }[] = [
  { value: 'close', label: 'Close' },
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'hl2', label: 'HL2' },
  { value: 'hlc3', label: 'HLC3' },
  { value: 'ohlc4', label: 'OHLC4' },
];

const LINE_WIDTHS = [1, 1.5, 2, 2.5, 3, 4];

/**
 * EMA Settings Panel Component
 */
export const EmaSettingsPanel: React.FC<EmaSettingsPanelProps> = ({
  configs,
  onChange,
  onReset,
  isOpen,
  onToggle,
}) => {
  const [expandedEma, setExpandedEma] = useState<number | null>(null);

  const handleToggleVisibility = useCallback((period: number) => {
    const updated = configs.map(c => 
      c.period === period ? { ...c, visible: !c.visible } : c
    );
    onChange(updated);
  }, [configs, onChange]);

  const handleUpdateConfig = useCallback((period: number, updates: Partial<EmaConfig>) => {
    const updated = configs.map(c => 
      c.period === period ? { ...c, ...updates } : c
    );
    onChange(updated);
  }, [configs, onChange]);

  const handleAddCustomEma = useCallback(() => {
    const existingPeriods = configs.map(c => c.period);
    let newPeriod = 10;
    while (existingPeriods.includes(newPeriod)) {
      newPeriod += 5;
    }

    const newConfig: EmaConfig = {
      period: newPeriod,
      source: 'close',
      color: '#9CA3AF',
      width: 1.5,
      opacity: 1,
      visible: true,
      label: `EMA ${newPeriod}`,
    };

    onChange([...configs, newConfig]);
    setExpandedEma(newPeriod);
  }, [configs, onChange]);

  const handleRemoveEma = useCallback((period: number) => {
    const updated = configs.filter(c => c.period !== period);
    onChange(updated);
  }, [configs, onChange]);

  const handleResetToDefaults = useCallback(() => {
    onReset();
    setExpandedEma(null);
  }, [onReset]);

  return (
    <div className="relative">
      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-[#0d1020]/90 px-3 py-2 text-xs font-black uppercase tracking-wider text-cyan-300 backdrop-blur transition hover:bg-cyan-500/20"
        title="EMA Settings"
      >
        <Settings className="h-4 w-4" />
        <span>EMA</span>
        {isOpen ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>

      {/* Settings Panel */}
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-cyan-500/20 bg-[#0d1020]/95 p-4 shadow-2xl backdrop-blur">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-wider text-cyan-300">
              EMA Settings
            </h3>
            <button
              onClick={handleResetToDefaults}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:bg-white/10 hover:text-white"
              title="Reset to defaults"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>

          {/* EMA List */}
          <div className="space-y-2">
            {configs.map((config) => (
              <div
                key={config.period}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
              >
                {/* EMA Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* Color Indicator */}
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: config.color }}
                    />
                    
                    {/* Period Label */}
                    <span className="text-sm font-bold text-white">
                      EMA {config.period}
                    </span>
                    
                    {/* Visibility Toggle */}
                    <button
                      onClick={() => handleToggleVisibility(config.period)}
                      className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
                      title={config.visible ? 'Hide EMA' : 'Show EMA'}
                    >
                      {config.visible ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {/* Expand/Collapse */}
                  <button
                    onClick={() => setExpandedEma(expandedEma === config.period ? null : config.period)}
                    className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
                  >
                    {expandedEma === config.period ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {/* Expanded Settings */}
                {expandedEma === config.period && (
                  <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
                    {/* Period */}
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Period
                      </label>
                      <input
                        type="number"
                        value={config.period}
                        onChange={(e) => {
                          const value = parseInt(e.target.value, 10);
                          if (value > 0 && value <= 500) {
                            handleUpdateConfig(config.period, { 
                              period: value,
                              label: `EMA ${value}`
                            });
                          }
                        }}
                        className="w-full rounded border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                        min={1}
                        max={500}
                      />
                    </div>

                    {/* Source */}
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Source
                      </label>
                      <select
                        value={config.source}
                        onChange={(e) => handleUpdateConfig(config.period, { 
                          source: e.target.value as PriceSource 
                        })}
                        className="w-full rounded border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                      >
                        {PRICE_SOURCES.map((source) => (
                          <option key={source.value} value={source.value}>
                            {source.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Color */}
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Color
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={config.color}
                          onChange={(e) => handleUpdateConfig(config.period, { 
                            color: e.target.value 
                          })}
                          className="h-8 w-8 rounded border border-white/20 bg-transparent"
                        />
                        <input
                          type="text"
                          value={config.color}
                          onChange={(e) => handleUpdateConfig(config.period, { 
                            color: e.target.value 
                          })}
                          className="flex-1 rounded border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Line Width */}
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Width
                      </label>
                      <div className="flex gap-2">
                        {LINE_WIDTHS.map((width) => (
                          <button
                            key={width}
                            onClick={() => handleUpdateConfig(config.period, { width })}
                            className={`flex-1 rounded border py-2 text-xs font-bold transition ${
                              config.width === width
                                ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300'
                                : 'border-white/20 bg-white/5 text-gray-400 hover:bg-white/10'
                            }`}
                          >
                            {width}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Opacity */}
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Opacity: {Math.round(config.opacity * 100)}%
                      </label>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.1}
                        value={config.opacity}
                        onChange={(e) => handleUpdateConfig(config.period, { 
                          opacity: parseFloat(e.target.value) 
                        })}
                        className="w-full"
                      />
                    </div>

                    {/* Remove Button (for custom EMAs) */}
                    {!DEFAULT_EMA_CONFIGS.some(d => d.period === config.period) && (
                      <button
                        onClick={() => handleRemoveEma(config.period)}
                        className="w-full rounded border border-red-500/30 bg-red-500/10 py-2 text-xs font-bold uppercase tracking-wider text-red-400 transition hover:bg-red-500/20"
                      >
                        Remove EMA {config.period}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add Custom EMA */}
          <button
            onClick={handleAddCustomEma}
            className="mt-4 w-full rounded-lg border border-dashed border-cyan-500/30 bg-cyan-500/5 py-3 text-xs font-bold uppercase tracking-wider text-cyan-400 transition hover:bg-cyan-500/10"
          >
            + Add Custom EMA
          </button>
        </div>
      )}
    </div>
  );
};

export default EmaSettingsPanel;
