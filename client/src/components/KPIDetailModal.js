import React, { useState, useMemo } from 'react';
import { deriveRag } from './KPICard';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Tooltip, Filler, Legend,
} from 'chart.js';
import { CHART_PALETTES, getChartTokens, chartTooltip, chartScales, getCSSVar } from './chartUtils';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler, Legend);

/* ─── RAG Helper ──────────────────────────────────────────── */
function getRag(value, thresholds, inverted, forceLevel) {
  const num = parseFloat(value) || 0;
  let level = forceLevel || 'normal';
  if (!forceLevel) {
    if (thresholds) {
      const { green, amber } = thresholds;
      if (!inverted) level = num >= green ? 'normal' : num >= amber ? 'warning' : 'critical';
      else           level = num <= green ? 'normal' : num <= amber ? 'warning' : 'critical';
    } else {
      level = num >= 80 ? 'normal' : num >= 50 ? 'warning' : 'critical';
    }
  }
  return {
    normal: {
      color: getCSSVar('--app-success'), text: 'text-emerald-400',
      dot: 'bg-emerald-400', label: 'NORMAL',
      solidBg: 'var(--app-modal-success-bg)', solidBorder: 'var(--app-modal-success-border)',
      badgeSolidBg: 'var(--app-modal-success-bg)', badgeSolidBorder: 'var(--app-modal-success-border)',
    },
    warning: {
      color: getCSSVar('--app-warning'), text: 'text-amber-400',
      dot: 'bg-amber-400', label: 'WARNING',
      solidBg: 'var(--app-modal-warning-bg)', solidBorder: 'var(--app-modal-warning-border)',
      badgeSolidBg: 'var(--app-modal-warning-bg)', badgeSolidBorder: 'var(--app-modal-warning-border)',
    },
    critical: {
      color: getCSSVar('--app-danger'), text: 'text-red-400',
      dot: 'bg-red-400', label: 'CRITICAL',
      solidBg: 'var(--app-modal-danger-bg)', solidBorder: 'var(--app-modal-danger-border)',
      badgeSolidBg: 'var(--app-modal-danger-bg)', badgeSolidBorder: 'var(--app-modal-danger-border)',
    },
  }[level];
}

/* ─── Deterministic series generators ────────────────────── */
function buildHist(numValue, trendPct, n) {
  const v0 = numValue || 50;
  const slope = (trendPct || 0) / 100 * v0 / n;
  return Array.from({ length: n }, (_, i) => {
    const v = v0 - slope * (n - i)
      + Math.sin(i * 0.8)       * v0 * 0.03
      + Math.sin(i * 0.3 + 1.2) * v0 * 0.015;
    return Math.max(0, parseFloat(v.toFixed(2)));
  });
}

function buildPred(hist, trendPct, n = 8) {
  const last = hist[hist.length - 1] || 50;
  const avg  = hist.reduce((a, b) => a + b, 0) / hist.length;
  const slope = (trendPct || 0) / 100 * avg / hist.length;
  return Array.from({ length: n }, (_, i) => {
    const v = last + slope * (i + 1) * 2 + Math.sin(i * 0.6) * avg * 0.02;
    return Math.max(0, parseFloat(v.toFixed(2)));
  });
}

/* ─── Time-range config — only 12H / 24H / 7D / 30D allowed ── */
const TIME_CFG = {
  '12H': { n: 12, lbl: (i) => `${String(i).padStart(2,'0')}:00`, title: '12-Hour (1-Hr Intervals)' },
  '24H': { n: 24, lbl: (i) => `${String(i).padStart(2,'0')}:00`, title: '24-Hour (1-Hr Intervals)' },
  '7D':  { n: 7,  lbl: (i) => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i % 7], title: '7-Day (Daily Intervals)' },
  '30D': { n: 30, lbl: (i) => `D${i + 1}`,                       title: '30-Day (Daily Intervals)' },
};

/**
 * Decide which timeframes a KPI can meaningfully be viewed at.
 * The rule: only offer a horizon if a change inside that horizon can
 * realistically affect the health of the underlying system.
 */
function getKpiTimeRanges(kpi) {
  const label = (kpi?.label || '').toLowerCase();
  const unit  = (kpi?.unit  || '').toLowerCase();
  // Strategic / sustainability KPIs — only multi-day signal is meaningful
  if (label.includes('carbon') || label.includes('co2') || label.includes('co₂') ||
      label.includes('circular') || label.includes('landfill capacity') ||
      label.includes('esg') || unit.includes('/100')) {
    return ['7D', '30D'];
  }
  // Daily ops with a weekly rollup
  if (label.includes('daily') || label.includes('ton') || label.includes('throughput') ||
      label.includes('intake') || label.includes('scheduled') || label.includes('collected') ||
      label.includes('recycling') || label.includes('citizen')) {
    return ['24H', '7D', '30D'];
  }
  // Realtime operational KPIs — same-day changes affect health
  if (label.includes('coverage') || label.includes('missed') || label.includes('overflow') ||
      label.includes('route') || label.includes('vehicle') || label.includes('idle') ||
      label.includes('fuel') || label.includes('power') || label.includes('temperature') ||
      label.includes('emission')) {
    return ['12H', '24H', '7D'];
  }
  return ['24H', '7D', '30D'];
}

/* ─── Threshold side-label plugin (per-instance) ─────────── */
function makePlugin(target, warn, inverted = false) {
  return {
    id: 'threshLineLabels',
    afterDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.y) return;
      const { right } = chartArea;
      const { y } = scales;
      ctx.save();
      ctx.font = '9px Inter,system-ui,sans-serif';
      ctx.textAlign = 'left';
      const draw = (val, color, text) => {
        if (val == null || isNaN(val) || val < y.min || val > y.max) return;
        ctx.fillStyle = color;
        ctx.fillText(text, right + 4, y.getPixelForValue(val) + 3);
      };
      // For inverted KPIs: upper line = Limit (amber), lower line = Optimal (green)
      // For normal KPIs:   upper line = Target (green), lower line = Warn (amber)
      draw(target, getCSSVar(inverted ? '--app-warning' : '--app-success'), inverted ? 'Limit'   : 'Target');
      draw(warn,   getCSSVar(inverted ? '--app-success' : '--app-warning'), inverted ? 'Optimal' : 'Warn');
      ctx.restore();
    },
  };
}

/* ─── Anomaly event generator ─────────────────────────────── */
function genEvents(label, ragLabel, inverted) {
  const breachDirection = inverted ? 'above' : 'below';
  if (ragLabel === 'CRITICAL') {
    return [
      { time: '03:22', sev: 'critical', text: `${label} anomaly detected — auto-escalation triggered to control room` },
      { time: '09:14', sev: 'warning',  text: `${label} ${breachDirection} warning threshold — alert dispatched to operations team` },
    ];
  }
  if (ragLabel === 'WARNING') {
    return [{ time: '09:14', sev: 'warning', text: `${label} ${breachDirection} warning threshold — monitoring interval increased to 5 min` }];
  }
  return [{ time: '14:30', sev: 'info', text: `${label} performing within optimal range — no immediate action required` }];
}

/* ─── Header code from label ─────────────────────────────── */
function toCode(label) {
  const words = (label || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0].slice(0, 4).toUpperCase()}-${words[1].slice(0, 3).toUpperCase()}`;
  return (label || 'KPI').slice(0, 7).toUpperCase();
}

/* ═══════════════════════════════════════════════════════════ */
export default function KPIDetailModal({ kpi, onClose, showAnalysis = true }) {
  const [timeRange, setTimeRange]           = useState('24H');
  const [showPrediction, setShowPrediction] = useState(false);
  const isLight    = typeof document !== 'undefined' && document.body?.dataset?.theme === 'light';
  const tileBg      = isLight ? 'var(--app-surface-raised)' : 'var(--app-surface)';
  const tileBorder  = `1px solid ${isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)'}`;
  const innerDiv    = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)';

  const numValue    = useMemo(() => parseFloat(kpi?.value) || 0, [kpi]);
  const rag         = useMemo(() => {
    // Prefer color-derived RAG so modal matches what the KPICard displays
    if (kpi?.color) {
      const key = deriveRag(kpi.color);
      return getRag(numValue, null, false, key);
    }
    return getRag(numValue, kpi?.thresholds, kpi?.inverted);
  }, [numValue, kpi]);
  const ytdAvg       = useMemo(() => numValue > 0 ? parseFloat((numValue * 0.977).toFixed(1)) : 0, [numValue]);
  const thirtyDayAvg = useMemo(() => numValue > 0 ? parseFloat((numValue * 0.964).toFixed(1)) : 0, [numValue]);

  const targetNum = useMemo(() => {
    if (kpi?.thresholds?.green != null) return kpi.thresholds.green;
    const p = parseFloat(kpi?.target);
    return isNaN(p) ? parseFloat((numValue * 1.05).toFixed(1)) : p;
  }, [kpi, numValue]);

  /* Series */
  const availableRanges = useMemo(() => getKpiTimeRanges(kpi), [kpi]);
  const activeTimeRange = availableRanges.includes(timeRange) ? timeRange : availableRanges[0];
  const cfg = TIME_CFG[activeTimeRange] || TIME_CFG['24H'];

  const hist = useMemo(
    () => buildHist(numValue, kpi?.trend, cfg.n),
    [numValue, kpi?.trend, activeTimeRange], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const pred = useMemo(() => buildPred(hist, kpi?.trend), [hist, kpi?.trend]);

  const histLabels = useMemo(
    () => Array.from({ length: cfg.n }, (_, i) => cfg.lbl(i)),
    [activeTimeRange], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const predLabels = useMemo(() => Array.from({ length: 8 }, (_, i) => `+${i + 1}h`), []);
  const allLabels = useMemo(
    () => (showPrediction ? [...histLabels, ...predLabels] : histLabels),
    [showPrediction, histLabels, predLabels],
  );

  /* Threshold reference values
   * For non-inverted KPIs: chartTargetVal = green (upper, goal), chartWarnVal = amber (lower, warning)
   * For inverted KPIs:     chartTargetVal = amber (upper limit to stay below), chartWarnVal = green (optimal level)
   * This guarantees the "Target" reference line is always drawn ABOVE the "Warn/Optimal" line.
   */
  const chartTargetVal = useMemo(() =>
    kpi?.thresholds
      ? (kpi.inverted ? kpi.thresholds.amber : kpi.thresholds.green)
      : targetNum,
    [kpi, targetNum],
  );
  const chartWarnVal = useMemo(() =>
    kpi?.thresholds ? (kpi.inverted ? kpi.thresholds.green : kpi.thresholds.amber) : null,
    [kpi],
  );

  const threshPlugin = useMemo(
    () => makePlugin(chartTargetVal, chartWarnVal, kpi?.inverted),
    [chartTargetVal, chartWarnVal, kpi?.inverted],
  );

  /* Threshold bands */
  const bands = useMemo(() => {
    const u = kpi?.unit || '';
    if (!kpi?.thresholds) {
      return [
        { label: 'NORMAL',   color: 'emerald', desc: `≥ 80${u}` },
        { label: 'WARNING',  color: 'amber',   desc: `50–80${u}` },
        { label: 'CRITICAL', color: 'red',     desc: `< 50${u}` },
      ];
    }
    const { green, amber } = kpi.thresholds;
    if (!kpi.inverted) {
      return [
        { label: 'NORMAL',   color: 'emerald', desc: `≥ ${green}${u}` },
        { label: 'WARNING',  color: 'amber',   desc: `${amber}–${green}${u}` },
        { label: 'CRITICAL', color: 'red',     desc: `< ${amber}${u}` },
      ];
    }
    return [
      { label: 'NORMAL',   color: 'emerald', desc: `≤ ${green}${u}` },
      { label: 'WARNING',  color: 'amber',   desc: `${green}–${amber}${u}` },
      { label: 'CRITICAL', color: 'red',     desc: `> ${amber}${u}` },
    ];
  }, [kpi]);

  /* Chart datasets */
  const chartData = useMemo(() => {
    const actualData = showPrediction ? [...hist, ...Array(8).fill(null)] : hist;
    const datasets = [
      {
        label: `${activeTimeRange} Actual`,
        data: actualData,
        borderColor: CHART_PALETTES.area.cyan.border,
        backgroundColor: CHART_PALETTES.area.cyan.fill,
        fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2.5,
      },
      ...(kpi?.thresholds ? [{
        label: kpi?.inverted ? 'Limit' : 'Target',
        data: Array(allLabels.length).fill(chartTargetVal),
        borderColor: kpi?.inverted ? getChartTokens().warningBar : getChartTokens().successBar,
        borderWidth: 1.5, borderDash: [6, 4],
        pointRadius: 0, fill: false, tension: 0,
      }] : []),
      ...(chartWarnVal != null ? [{
        label: kpi?.inverted ? 'Optimal' : 'Warn',
        data: Array(allLabels.length).fill(chartWarnVal),
        borderColor: kpi?.inverted ? getChartTokens().successBar : getChartTokens().warningBar,
        borderWidth: 1.5, borderDash: [3, 3],
        pointRadius: 0, fill: false, tension: 0,
      }] : []),
      ...(showPrediction ? [{
        label: 'Predicted',
        data: [...Array(hist.length).fill(null), ...pred],
        borderColor: getChartTokens().violet,
        backgroundColor: getChartTokens().violetBg,
        fill: true, tension: 0.4, pointRadius: 2.5,
        pointBackgroundColor: getChartTokens().violet, pointBorderColor: getCSSVar('--app-bg'),
        borderWidth: 2, borderDash: [6, 4],
      }] : []),
    ];
    return { labels: allLabels, datasets };
  }, [hist, pred, allLabels, showPrediction, kpi, chartTargetVal, chartWarnVal, activeTimeRange]);

  const chartOpts = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { right: kpi?.thresholds ? 46 : 8 } },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: getCSSVar('--app-text-muted'),
          font: { size: 9 },
          boxWidth: 18,
          padding: 10,
          usePointStyle: true,
          filter: (item) => !item.text.startsWith(`${activeTimeRange} Actual`),
        },
      },
      tooltip: {
        ...chartTooltip(),
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) : '—'} ${kpi?.unit || ''}`,
        },
      },
    },
    scales: chartScales({ x: { ticks: { maxTicksLimit: 12 } } }),
  }), [kpi, isLight]); // eslint-disable-line react-hooks/exhaustive-deps

  const events   = useMemo(() => genEvents(kpi?.label, rag.label, kpi?.inverted), [kpi?.label, rag.label, kpi?.inverted]);
  const analyses = useMemo(() => (kpi?.analysis || '').split('|').map(s => s.trim()).filter(s => s.length > 3), [kpi?.analysis]);
  const subs       = kpi?.subValues || [];
  const mainSubs   = subs.filter(m => !/target/i.test(m.label));
  const targetSubs = subs.filter(m => /target/i.test(m.label));

  if (!kpi) return null;

  const code     = toCode(kpi.label);
  const category = kpi.category || 'SWM DASHBOARD';

  return (
    <div className="fixed inset-0 z-[1100] flex justify-end">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />

      <div className="relative h-full kpi-modal flex flex-col shadow-2xl animate-slide-in-right" style={{ width: 680, borderLeft: '1px solid var(--app-border)', borderRadius: 0, background: 'var(--app-panel)' }}>

        {/* ── HEADER ─────────────────────────────────────────── */}
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderRadius: 0, flexShrink: 0, borderBottom: isLight ? '1px solid var(--app-border)' : '1px solid rgba(255,255,255,0.09)' }}>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: 'var(--app-surface-raised)', border: '1px solid var(--app-border)' }}>
              {kpi.icon}
            </div>
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-[0.2em] font-bold mb-0.5">
                {code} · {category}
              </p>
              <h2 className="text-lg font-bold text-white leading-tight">{kpi.label}</h2>
            </div>
          </div>
          <div className="flex items-center space-x-3 flex-shrink-0">
            <span className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold ${rag.text}`} style={{ background: rag.badgeSolidBg, borderColor: rag.badgeSolidBorder }}>
              <span className={`w-1.5 h-1.5 rounded-full ${rag.dot}`} />
              <span>{rag.label}</span>
            </span>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── BODY — Bento grid, no-scroll ──────────────────── */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px' }}>

          {/* ── ROW 1: Metric strip ─────────────────────────── */}
          <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {[
              { label: 'Current',    val: kpi.value,      unit: kpi.unit, sub: `${(kpi.trend||0)>=0?'+':'−'}${Math.abs(kpi.trend||0).toFixed(1)}% vs yesterday`, subColor: (kpi.trend||0) >= 0 ? '#22c55e' : '#ef4444' },
              { label: 'Target',     val: targetNum,       unit: kpi.unit },
              { label: 'YTD Avg',    val: ytdAvg,          unit: kpi.unit },
              { label: '30-Day Avg', val: thirtyDayAvg,    unit: kpi.unit },
            ].map((m, i) => (
              <div key={i} style={{ background: i === 0 ? rag.solidBg : tileBg, border: i === 0 ? `1px solid ${rag.solidBorder}` : tileBorder, borderRadius: 10, padding: '10px 14px' }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--app-text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>{m.label}</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--app-text)', lineHeight: 1 }}>
                  {m.val}{m.unit && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--app-text-faint)', marginLeft: 3 }}>{m.unit}</span>}
                </p>
                {m.sub && <p style={{ fontSize: 9, color: m.subColor, marginTop: 5, fontWeight: 600 }}>{m.sub}</p>}
              </div>
            ))}
          </div>

          {/* ── ROW 2: Main bento row — chart (left) + side panel (right) ── */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 8 }}>

            {/* Chart panel */}
            <div style={{ flex: 3, minWidth: 0, background: tileBg, border: tileBorder, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--app-text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{cfg.title}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="cwm-timeframe-control">
                    {availableRanges.map((r) => (
                      <button key={r} onClick={() => { setTimeRange(r); setShowPrediction(false); }}
                        className={`cwm-timeframe-btn ${activeTimeRange === r ? 'is-active' : ''}`}>{r}</button>
                    ))}
                  </div>
                  <button onClick={() => setShowPrediction((p) => !p)}
                    className={`cwm-advisory-btn${showPrediction ? ' is-on' : ''}`}
                    style={{ height: 24, padding: '0 8px', fontSize: 10, borderRadius: 5, boxShadow: showPrediction ? undefined : 'none' }}>
                    <span>✦</span><span>Predict</span>
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <Line data={chartData} options={chartOpts} plugins={[threshPlugin]} />
              </div>
              <div style={{ display: 'flex', gap: 20, paddingTop: 8, borderTop: `1px solid ${innerDiv}`, marginTop: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                {bands.map((b, i) => {
                  const c = b.color === 'emerald' ? getCSSVar('--app-success') : b.color === 'amber' ? getCSSVar('--app-warning') : getCSSVar('--app-danger');
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />
                      <span style={{ fontSize: 9, fontWeight: 700, color: c, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{b.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--app-text)' }}>{b.desc}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Side panel: Definition + Anomalies + Related Metrics + AI Advisory */}
            <div style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>

              {/* Definition */}
              {kpi.definition && (
                <div style={{ flexShrink: 0, background: tileBg, border: tileBorder, borderRadius: 12, padding: '10px 12px' }}>
                  <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--app-text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Definition</p>
                  <p style={{ fontSize: 11, color: 'var(--app-text)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{kpi.definition}</p>
                </div>
              )}

              {/* Anomalies & Events — fills all remaining space */}
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: tileBg, border: tileBorder, borderRadius: 12, padding: '10px 12px' }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--app-text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Anomalies &amp; Events</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {events.map((e, i) => {
                    const sevColor = e.sev === 'critical' ? getCSSVar('--app-danger') : e.sev === 'warning' ? getCSSVar('--app-warning') : 'var(--app-text-faint)';
                    return (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: sevColor, flexShrink: 0, fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>{e.time}</span>
                        <p style={{ fontSize: 10, color: 'var(--app-text)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.text}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Related Metrics — fixed height tile */}
              {subs.length > 0 && (
                <div style={{ flexShrink: 0, background: tileBg, border: tileBorder, borderRadius: 12, padding: '10px 12px' }}>
                  <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--app-text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Related Metrics</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 12px' }}>
                    {mainSubs.map((m, i) => (
                      <div key={i} style={{ borderLeft: '2px solid #60a5fa', paddingLeft: 8 }}>
                        <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--app-text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{m.label}</p>
                        <p style={{ fontSize: 15, fontWeight: 700, color: '#60a5fa', lineHeight: 1 }}>{m.value}</p>
                      </div>
                    ))}
                    {targetSubs.map((m, i) => (
                      <div key={i} style={{ borderLeft: `2px solid ${innerDiv}`, paddingLeft: 8 }}>
                        <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--app-text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Target</p>
                        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--app-text-muted)', lineHeight: 1 }}>{m.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* ── ROW 3: AI Advisory — full-width bottom bar ───────────────── */}
          {showAnalysis && analyses.length > 0 && (
            <div style={{
              flexShrink: 0,
              background: 'var(--app-modal-advisory-bg)',
              border: '1px solid var(--app-modal-advisory-border)',
              borderRadius: 12,
              padding: '10px 14px',
            }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--app-advisory)', textTransform: 'uppercase', letterSpacing: '0.18em', flexShrink: 0 }}>✦ AI Advisory</span>
                <div style={{ flex: 1, height: '1px', background: innerDiv }} />
                <span style={{ fontSize: 9, color: 'var(--app-text-faint)', fontStyle: 'italic', flexShrink: 0 }}>Platform Insight Engine</span>
              </div>
              {/* 3-column insight grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 14px' }}>
                {analyses.slice(0, 3).map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                    <span style={{
                      minWidth: 17, height: 17, borderRadius: '50%',
                      background: 'var(--app-advisory)', color: 'var(--app-panel)',
                      fontWeight: 800, fontSize: 9, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginTop: 1,
                    }}>{i + 1}</span>
                    <p style={{ fontSize: 10, color: 'var(--app-text)', lineHeight: 1.5 }}>{s.trim()}.</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── FOOTER ─────────────────────────────────────────── */}
        <div className="px-5 py-2.5 flex items-center justify-between" style={{ borderRadius: 0, flexShrink: 0, borderTop: isLight ? '1px solid var(--app-border)' : '1px solid rgba(255,255,255,0.09)' }}>
          <p className="text-[10px] text-slate-400">
            Last updated: {new Date().toLocaleTimeString()} · HSL Design Validator
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 cwm-control-btn text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

