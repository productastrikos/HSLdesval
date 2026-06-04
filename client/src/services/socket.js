import React, { createContext, useContext, useState, useCallback } from 'react';

const SocketContext = createContext(null);
export const DataContext = createContext(null);

// ── HSL validation alerts (populated by real AI scans — no seed data) ────────
const SEED_ALERTS = [];

// ── HSL KPI snapshot — values aligned to Astrikos.ai Tech Solution Doc ─────
const SEED_KPIS = {
  // Performance targets from the doc: <2s response, >99.5% uptime
  avgResponseMs:         1480,    // < 2000 ms target
  responseTrend:        -3.4,
  uptimePct:           99.74,     // > 99.50% target
  uptimeTrend:           0.04,

  // Knowledge & document corpus
  documentsIndexed:     1284,
  documentsTrend:        4.2,
  rulesParsed:          37412,
  rulesTrend:            1.8,
  ocrPagesProcessed:    52740,
  ocrEngineConfidence:  98.4,

  // Usage analytics
  queriesAnswered:        946,
  queriesTrend:          7.1,
  specsGenerated:         118,
  specsTrend:            6.0,

  // Compliance & validation
  complianceScore:       94.6,
  complianceTrend:       0.9,
  openFindings:            23,
  findingsTrend:        -12.4,

  // Scope coverage — per Tech Solution Doc §Project Brief
  domainsCovered:           6,    // Electrical, Mechanical, Piping, HVAC, Hull, Outfit
  classSocieties:           4,    // IRS, DNV, ABS, IACS
  standardsBodies:          3,    // IMO, IEC, Naval (NSQR)

  // Hardware / infra (per Hardware Requirements table in doc)
  gpuUtilizationPct:     38.2,    // NVIDIA A100 80 GB
  cpuUtilizationPct:     22.6,    // 2× 16-core EPYC / Xeon Gold
  ramUsedGb:             184,     // of 512 GB DDR4 ECC
  storageUsedTb:          12.4,   // of 8 TB NVMe + 100 TB+ NAS
};

// ── HSL AI advisories (populated by real AI scans — no seed data) ────────────
const SEED_ADVISORIES = [];

const SEED_BINS_SUMMARY = {};
const SEED_VEHICLES_SUMMARY = {};

export function SocketProvider({ children }) {
  const [alerts, setAlerts] = useState(SEED_ALERTS);

  const acknowledgeAlert = useCallback((alertId) => {
    setAlerts(prev => prev.map(a => a.alertId === alertId ? { ...a, acknowledged: true } : a));
  }, []);

  const dataValue = {
    kpis:             SEED_KPIS,
    alerts,
    advisories:       SEED_ADVISORIES,
    weather:          null,
    binsSummary:      SEED_BINS_SUMMARY,
    vehiclesSummary:  SEED_VEHICLES_SUMMARY,
    lastUpdate:       new Date(),
    connected:        false,
    requestData:      () => {},
    acknowledgeAlert,
  };

  return (
    <SocketContext.Provider value={null}>
      <DataContext.Provider value={dataValue}>
        {children}
      </DataContext.Provider>
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
export const useData   = () => useContext(DataContext);
