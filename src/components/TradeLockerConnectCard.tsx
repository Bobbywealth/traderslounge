// TradeLockerConnectCard — Settings page card for linking a TradeLocker
// demo or live broker account. Surfaces real TradeLocker error messages
// (HTTP 400 "Incorrect email or password", missing server, CORS) instead
// of a generic "Failed to connect" so Bobby can debug without devtools.
//
// State flow:
//   - read-only BrokerCredentials managed by BrokerContext (localStorage).
//   - on connect: addCredentials → testConnection → returns real status.
//   - on disconnect: removeCredentials + clear chart-side auth state.
//
// TradeLocker is the only broker with a live integration; the rest throw
// "not supported" and we don't expose them here.

import React, { useState, useEffect } from 'react';
import { Link, Link2, Loader2, Power, ShieldAlert, Trash2 } from 'lucide-react';
import { useBroker } from '../contexts/BrokerContext';

const TradeLockerConnectCard: React.FC = () => {
  const { credentials, addCredentials, removeCredentials, testConnection, connectionStatus } = useBroker();
  const existing = credentials.find((c) => c.brokerType === 'trade_locker');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState('demo');
  const [accountId, setAccountId] = useState('');
  const [isDemo, setIsDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // When a saved TradeLocker credential exists, hydrate the form (without
  // the password — never re-populate a password from localStorage).
  useEffect(() => {
    if (existing) {
      setEmail(existing.email || '');
      setServer(existing.server || 'demo');
      setAccountId(existing.accountId || '');
      setIsDemo(existing.isDemo);
    }
  }, [existing?.id]);

  // When testConnection writes a new error to connectionStatus[existing.id],
  // mirror it into local error state so the card can render it. This bridges
  // the async state-update gap that the closure-based read in the click
  // handler can't see.
  useEffect(() => {
    if (!existing) return;
    const status = connectionStatus[existing.id];
    if (status?.error) {
      setError(status.error);
    }
    if (status?.isConnected && !success) {
      setSuccess(`Connected to ${existing.isDemo ? 'demo' : 'live'} TradeLocker${existing.server ? ` (${existing.server})` : ''}.`);
    }
  }, [connectionStatus[existing?.id]?.error, connectionStatus[existing?.id]?.isConnected, existing?.id]);

  const status = existing ? connectionStatus[existing.id] : undefined;
  const isConnected = !!status?.isConnected;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      // Add or reuse the existing TradeLocker credential.
      let credId: string;
      if (existing) {
        credId = existing.id;
      } else {
        credId = `${Date.now()}`;
        addCredentials({
          name: 'TradeLocker',
          brokerType: 'trade_locker',
          apiKey: '',
          apiSecret: '',
          accountId: accountId.trim() || undefined,
          serverUrl: isDemo
            ? 'https://demo.tradelocker.com/backend-api'
            : 'https://live.tradelocker.com/backend-api',
          email: email.trim(),
          password,
          server,
          isDemo,
          isActive: true,
        });
      }

      const ok = await testConnection(credId);
      if (ok) {
        // success is mirrored by the useEffect above watching connectionStatus
        setPassword('');
      }
      // On failure the real TradeLocker error is set by BrokerContext into
      // connectionStatus[credId].error and mirrored here by the useEffect
      // above. No need to set a fallback in this branch.
    } catch (err: any) {
      setError(err?.message || 'Connection failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = () => {
    if (!existing) return;
    if (!window.confirm('Disconnect TradeLocker? Your saved credentials will be removed from this browser.')) return;
    removeCredentials(existing.id);
    setPassword('');
    setSuccess(null);
    setError(null);
  };

  return (
    <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Link2 className="w-4 h-4 text-emerald-400" />
          Broker Connection — TradeLocker
        </h3>
        {existing && (
          <span
            className={`text-xs px-2 py-0.5 rounded border ${
              isConnected
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-gray-700/40 text-gray-400 border-gray-600/40'
            }`}
            title={status?.error || ''}
          >
            {isConnected ? 'CONNECTED' : 'SAVED · NOT CONNECTED'}
          </span>
        )}
      </div>

      <p className="text-sm cx-text-faint mb-4">
        Link your TradeLocker account to stream live demo or live data into the chart.
        Credentials are stored locally in your browser — never sent to ConfluenceX servers.
        TradeLocker is the only broker with a live integration today.
      </p>

      {isConnected && existing && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-lg px-4 py-3 mb-4 flex items-start justify-between gap-3">
          <div className="text-sm">
            <div className="font-semibold mb-1">Connected</div>
            <div className="text-xs opacity-80">
              {existing.email}{existing.server ? ` · ${existing.server}` : ''} · {existing.isDemo ? 'demo' : 'live'}
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 disabled:opacity-50"
          >
            <Power className="w-3 h-3" />
            Disconnect
          </button>
        </div>
      )}

      <form onSubmit={handleConnect} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs cx-text-faint mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full bg-gray-800 cx-text-strong rounded px-3 py-2 border border-gray-700 focus:border-emerald-500 focus:outline-none text-sm"
              placeholder="your@email.com"
            />
          </div>
          <div>
            <label className="block text-xs cx-text-faint mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-gray-800 cx-text-strong rounded px-3 py-2 border border-gray-700 focus:border-emerald-500 focus:outline-none text-sm"
              placeholder={isConnected ? '•••••••• (re-enter to reconnect)' : 'Your TradeLocker password'}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs cx-text-faint mb-1">Server</label>
            <input
              type="text"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              list="tradelocker-servers"
              className="w-full bg-gray-800 cx-text-strong rounded px-3 py-2 border border-gray-700 focus:border-emerald-500 focus:outline-none text-sm"
              placeholder="e.g. GATES FX, HEROFX, demo, live"
            />
            <datalist id="tradelocker-servers">
              <option value="demo" />
              <option value="HEROFX" />
              <option value="GATES FX" />
              <option value="live" />
            </datalist>
            <p className="text-[10px] cx-text-faint mt-1">
              Type your broker's server name exactly as TradeLocker shows it.
            </p>
          </div>
          <div>
            <label className="block text-xs cx-text-faint mb-1">Account ID (optional)</label>
            <input
              type="text"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full bg-gray-800 cx-text-strong rounded px-3 py-2 border border-gray-700 focus:border-emerald-500 focus:outline-none text-sm"
              placeholder="Trading Account ID"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm cx-text-faint">
          <input
            type="checkbox"
            checked={isDemo}
            onChange={(e) => setIsDemo(e.target.checked)}
            className="rounded border-gray-600 text-emerald-500 focus:ring-emerald-500"
          />
          Use demo environment ({isDemo ? 'demo.tradelocker.com' : 'live.tradelocker.com'})
        </label>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-3 py-2 text-xs flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-lg px-3 py-2 text-xs">
            {success}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 cx-text-strong rounded-lg text-sm font-medium transition-colors"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Link className="w-4 h-4" />
            )}
            {isConnected ? 'Reconnect' : existing ? 'Reconnect' : 'Connect TradeLocker'}
          </button>
          {existing && (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 cx-text-strong rounded-lg text-sm font-medium transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Remove saved credentials
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default TradeLockerConnectCard;
