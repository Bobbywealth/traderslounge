// Positions — open trades view. STUB.
//
// The Python read API does not yet expose /api/positions. PaperBroker
// holds positions in memory inside the execution worker; TradeLocker
// positions live with the broker. A persistence layer + endpoint will
// land in a follow-up step.

import React from 'react';
import { Briefcase, AlertCircle } from 'lucide-react';

const Positions: React.FC = () => (
  <div className="space-y-6">
    <div>
      <h1 className="text-3xl font-bold text-white flex items-center gap-3">
        <Briefcase className="w-8 h-8 text-emerald-400" />
        Positions
      </h1>
      <p className="text-gray-400 mt-1">Currently open trades from the execution worker.</p>
    </div>

    <div className="bg-gray-900/60 border border-amber-500/30 rounded-xl p-6">
      <div className="flex items-start gap-4">
        <AlertCircle className="w-6 h-6 text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="text-lg font-semibold text-white mb-2">API endpoint not yet exposed</h3>
          <p className="text-gray-400 text-sm leading-relaxed">
            The execution worker holds open positions in memory (paper mode) or
            with TradeLocker (live mode), but the Python read API does not yet
            expose them. The next backend step adds a positions repository
            (PaperBroker writes to Postgres; TradeLocker positions sync via
            polling) and a <code className="text-emerald-300">/api/positions</code> endpoint.
          </p>
        </div>
      </div>
    </div>
  </div>
);

export default Positions;
