// Journal — closed-trade history + stats. STUB.
//
// Requires a closed-trades persistence layer (TradeManager logs exits to
// Postgres) and a /api/journal endpoint. Both land in a follow-up step.

import React from 'react';
import { BookOpen, AlertCircle } from 'lucide-react';

const Journal: React.FC = () => (
  <div className="space-y-6">
    <div>
      <h1 className="text-3xl font-bold text-white flex items-center gap-3">
        <BookOpen className="w-8 h-8 text-emerald-400" />
        Journal
      </h1>
      <p className="text-gray-400 mt-1">
        Closed-trade history, win rate, average R:R, daily/weekly stats.
      </p>
    </div>

    <div className="bg-gray-900/60 border border-amber-500/30 rounded-xl p-6">
      <div className="flex items-start gap-4">
        <AlertCircle className="w-6 h-6 text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="text-lg font-semibold text-white mb-2">Backend not yet wired</h3>
          <p className="text-gray-400 text-sm leading-relaxed">
            TradeManager needs to persist trade exits to a{' '}
            <code className="text-emerald-300">closed_trades</code> table and the
            read API needs a <code className="text-emerald-300">/api/journal</code>
            endpoint. The backtester already produces the same shape — see{' '}
            <code className="text-emerald-300">scanner/backtester.py</code>.
          </p>
        </div>
      </div>
    </div>
  </div>
);

export default Journal;
