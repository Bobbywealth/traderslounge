import React, { useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, RefreshCw } from 'lucide-react';
import { bwtsApi, type ValidationReport } from '../services/bwtsApi';

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const metric = (value: number | undefined, digits = 3) => Number(value || 0).toFixed(digits);

const Backtester: React.FC = () => {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await bwtsApi.validationReport());
    } catch (reason: any) {
      setError(reason?.message || 'Validation report unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  const calibration = report?.calibration;
  const bins = calibration?.reliability_bins || [];
  const maxBin = Math.max(1, ...bins.map((bin) => bin.sample_size));

  return (
    <div className="space-y-6">
      <section className="rounded-[24px] border border-violet-400/15 bg-[#090d18] bg-gradient-to-br from-violet-500/10 to-cyan-500/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-black tracking-[0.22em] text-cyan-300">DECISION VALIDATION</div>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-black text-white"><BarChart3 className="h-7 w-7 text-cyan-300" /> Calibration & Walk-Forward</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">Outcome evidence, leakage-safe replay, setup slices, expectancy, and adverse excursion. Scenario weights remain uncalibrated until the evidence passes the thresholds below.</p>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs font-black text-cyan-200 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
      </section>

      {error && <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div>}
      {!error && report && (
        <>
          <section className={`rounded-2xl border p-4 ${report.status === 'CALIBRATED' ? 'border-emerald-400/25 bg-emerald-400/[0.07]' : 'border-amber-400/25 bg-amber-400/[0.07]'}`}>
            <div className="flex items-start gap-3">
              {report.status === 'CALIBRATED' ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <AlertTriangle className="h-5 w-5 text-amber-300" />}
              <div><div className="text-sm font-black text-white">{report.status.replace(/_/g, ' ')}</div><p className="mt-1 text-xs leading-relaxed text-slate-400">{report.warning}</p></div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="RESOLVED OUTCOMES" value={String(report.resolved)} />
            <Metric label="PENDING OUTCOMES" value={String(report.pending)} />
            <Metric label="BRIER SCORE" value={metric(calibration?.brier_score)} />
            <Metric label="CALIBRATION ERROR" value={pct(calibration?.calibration_error || 0)} />
            <Metric label="PRECISION" value={pct(calibration?.precision || 0)} />
            <Metric label="RECALL" value={pct(calibration?.recall || 0)} />
            <Metric label="EXPECTANCY" value={`${metric(calibration?.expectancy_r, 2)}R`} />
            <Metric label="MAX ADVERSE EXCURSION" value={`${metric(calibration?.max_mae, 2)}R`} />
          </section>

          <section className="rounded-[20px] border border-white/[0.08] bg-[#090d18] p-5">
            <div className="flex items-center justify-between"><div><div className="text-[9px] font-black tracking-[0.18em] text-violet-300">RELIABILITY CURVE</div><h2 className="mt-1 text-lg font-black">Weight versus observed outcome</h2></div><span className="rounded-md bg-white/[0.05] px-2 py-1 text-[9px] font-black text-slate-400">{calibration?.sample_size || 0} samples</span></div>
            <div className="mt-5 grid grid-cols-10 items-end gap-2">
              {bins.map((bin, index) => (
                <div key={index} className="text-center">
                  <div className="relative mx-auto h-36 w-full rounded-md bg-white/[0.03]">
                    <div className="absolute bottom-0 w-full rounded-md bg-gradient-to-t from-violet-500/60 to-cyan-400/70" style={{ height: `${Math.max(2, ((bin.observed_rate || 0) * 100))}%`, opacity: 0.35 + (bin.sample_size / maxBin) * 0.65 }} />
                  </div>
                  <div className="mt-2 text-[8px] font-black text-slate-600">{index * 10}-{(index + 1) * 10}</div>
                  <div className="text-[8px] text-slate-500">n={bin.sample_size}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[20px] border border-white/[0.08] bg-[#090d18] p-5">
            <div className="text-[9px] font-black tracking-[0.18em] text-cyan-300">LEAKAGE CONTROL</div>
            <h2 className="mt-1 text-lg font-black">Expanding-window walk-forward</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3"><Metric label="NO LOOK-AHEAD" value={report.walk_forward.no_lookahead ? 'YES' : 'NO'} /><Metric label="FOLDS" value={String(report.walk_forward.folds_used)} /><Metric label="OOS SAMPLE" value={String(report.walk_forward.out_of_sample?.sample_size || 0)} /></div>
          </section>
        </>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded-xl border border-white/[0.07] bg-[#090d18] p-4"><div className="text-[9px] font-black tracking-[0.15em] text-slate-500">{label}</div><div className="mt-2 text-2xl font-black text-white">{value}</div></div>;

export default Backtester;
