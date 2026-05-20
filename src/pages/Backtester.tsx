// Backtester UI. STUB.
//
// The backtest engine works (scanner.backtester.run_backtest) — for now
// it's CLI-driven via `python -m scanner.backtest_cli`. A web UI needs
// a /api/backtests endpoint (POST to run, GET to fetch results) and a
// way to upload historical CSV data.

import React from 'react';
import { Play, AlertCircle } from 'lucide-react';

const Backtester: React.FC = () => (
  <div className="space-y-6">
    <div>
      <h1 className="text-3xl font-bold text-white flex items-center gap-3">
        <Play className="w-8 h-8 text-emerald-400" />
        Backtester
      </h1>
      <p className="text-gray-400 mt-1">
        Replay historical OHLCV through the scoring engine and see hypothetical performance.
      </p>
    </div>

    <div className="bg-gray-900/60 border border-amber-500/30 rounded-xl p-6">
      <div className="flex items-start gap-4">
        <AlertCircle className="w-6 h-6 text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="text-lg font-semibold text-white mb-2">CLI only for now</h3>
          <p className="text-gray-400 text-sm leading-relaxed mb-3">
            The backtest engine works today. Run from the project root:
          </p>
          <pre className="bg-black/40 border border-gray-700 rounded-lg p-3 text-xs text-emerald-300 overflow-x-auto">
{`python -m scanner.backtest_cli \\
  --pair XAUUSD \\
  --fixture data/xauusd_history.csv \\
  --balance 10000 \\
  --risk-pct 0.5`}
          </pre>
          <p className="text-gray-400 text-sm mt-3">
            A web UI for this needs a backend job runner and historical-data upload
            flow — coming in a follow-up step.
          </p>
        </div>
      </div>
    </div>
  </div>
);

export default Backtester;
