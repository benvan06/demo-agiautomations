import React, { useEffect, useMemo, useState } from "react";

/**
 * Pipeline Scoreboard (Real Estate WBR) — Single-file React + Tailwind
 * Display-first, no external data. Inline edits, 8-week scoreboard, WoW deltas, sparklines, channel mix.
 * Tests Gate, Present mode, Copy Markdown/JSON, Audit hash + localStorage baseline/lastRun.
 *
 * Inputs schema (internal state):
 * weeks[8]: {
 *   endISO: string,
 *   kpi: { revenue: number, orders: number, active: number, cac: number },
 *   channels: Record<"paid"|"organic"|"email"|"referral", number>
 * }
 * channelMetric: "revenue"|"orders"|"sessions"   // label only for channel table
 * alertThreshold: number (0.05–0.30)
 * logicVersion: string
 */

export default function App() {
  // ---------- Defaults (8 weeks sample tailored to real estate) ----------
  const defaultWeeks = useMemo(() => {
    return [
      {
        endISO: "2025-07-13",
        kpi: { revenue: 31250, orders: 9, active: 86, cac: 590 },
        channels: { paid: 210, organic: 150, email: 90, referral: 40 },
      },
      {
        endISO: "2025-07-20",
        kpi: { revenue: 29800, orders: 8, active: 80, cac: 615 },
        channels: { paid: 190, organic: 155, email: 85, referral: 44 },
      },
      {
        endISO: "2025-07-27",
        kpi: { revenue: 33500, orders: 10, active: 92, cac: 570 },
        channels: { paid: 220, organic: 165, email: 95, referral: 48 },
      },
      {
        endISO: "2025-08-03",
        kpi: { revenue: 34100, orders: 10, active: 94, cac: 560 },
        channels: { paid: 230, organic: 170, email: 96, referral: 52 },
      },
      {
        endISO: "2025-08-10",
        kpi: { revenue: 32900, orders: 9, active: 88, cac: 580 },
        channels: { paid: 205, organic: 175, email: 92, referral: 49 },
      },
      {
        endISO: "2025-08-17",
        kpi: { revenue: 35200, orders: 11, active: 97, cac: 545 },
        channels: { paid: 235, organic: 182, email: 100, referral: 55 },
      },
      {
        endISO: "2025-08-24",
        kpi: { revenue: 37100, orders: 12, active: 103, cac: 530 },
        channels: { paid: 245, organic: 190, email: 104, referral: 58 },
      },
      {
        endISO: "2025-08-31",
        kpi: { revenue: 36250, orders: 11, active: 100, cac: 540 },
        channels: { paid: 240, organic: 188, email: 101, referral: 60 },
      },
    ];
  }, []);

  const [weeks, setWeeks] = useState(defaultWeeks);
  const [channelMetric, setChannelMetric] = useState("orders");
  const [alertThreshold, setAlertThreshold] = useState(0.1);
  const [logicVersion, setLogicVersion] = useState("1.0.0-re");
  const [present, setPresent] = useState(false);

  // ---------- Audit: docId + canonicalized hash; persist baseline/lastRun ----------
  const [docId, setDocId] = useState(ensureDocId());
  const [hashHex, setHashHex] = useState("");
  const [baseline, setBaseline] = useState(() => loadBaseline());
  const [lastRun, setLastRun] = useState(() => loadLastRun());

  useEffect(() => {
    // Compute canonicalized hash when inputs change
    const payload = {
      weeks: weeks.map(({ endISO, kpi, channels }) => ({ endISO, kpi, channels })),
      channelMetric,
      alertThreshold,
      logicVersion,
    };
    canonicalHash(payload).then((hex) => setHashHex(hex));
  }, [weeks, channelMetric, alertThreshold, logicVersion]);

  useEffect(() => {
    // Establish baseline if none
    if (!baseline) {
      const b = { docId, hash: hashHex, ts: new Date().toISOString() };
      if (hashHex) {
        setBaseline(b);
        saveBaseline(b);
      }
    }
  }, [baseline, docId, hashHex]);

  useEffect(() => {
    // Update lastRun each mount
    const nowISO = new Date().toISOString();
    setLastRun(nowISO);
    saveLastRun(nowISO);
  }, []);

  // ---------- Derived metrics ----------
  const kpiKeys = [
    { key: "revenue", label: "Revenue", sub: "(Fees)", fmt: fmtCurrency },
    { key: "orders", label: "Deals", sub: "(Sales/Lets)", fmt: fmtInteger },
    { key: "active", label: "Active", sub: "(Viewings)", fmt: fmtInteger },
    { key: "cac", label: "CAC", sub: "(£/Instruction)", fmt: fmtCurrency },
  ];

  const series = useMemo(() => {
    const rev = weeks.map((w) => w.kpi.revenue);
    const ord = weeks.map((w) => w.kpi.orders);
    const act = weeks.map((w) => w.kpi.active);
    const cac = weeks.map((w) => w.kpi.cac);
    return { revenue: rev, orders: ord, active: act, cac };
  }, [weeks]);

  const deltas = useMemo(() => {
    // WoW deltas across 8 weeks; CAC inverted
    const mk = (arr, invert = false) =>
      arr.map((v, i) => {
        if (i === 0) return null; // first week has no previous
        const last = arr[i - 1];
        if (!isFiniteNum(last) || last === 0) return null; // rule: last==0 => null
        const raw = (v - last) / last; // normal
        return invert ? -raw : raw;
      });
    return {
      revenue: mk(series.revenue),
      orders: mk(series.orders),
      active: mk(series.active),
      cac: mk(series.cac, true), // invert
    };
  }, [series]);

  const anomalies = useMemo(() => {
    const obj = {};
    for (const k of Object.keys(deltas)) {
      obj[k] = (deltas[k] || []).map((d) => (d == null ? false : Math.abs(d) >= alertThreshold));
    }
    return obj;
  }, [deltas, alertThreshold]);

  const latestWeek = weeks[weeks.length - 1];
  const prevWeek = weeks[weeks.length - 2];

  // Channel table (This vs Last, WoW, Share) using selected channelMetric label
  const channelRows = useMemo(() => {
    const thisTotal = sumChannels(latestWeek.channels);
    const lastTotal = prevWeek ? sumChannels(prevWeek.channels) : 0;
    return ["paid", "organic", "email", "referral"].map((ch) => {
      const thisVal = latestWeek.channels[ch] || 0;
      const lastVal = prevWeek ? prevWeek.channels[ch] || 0 : 0;
      const wow = lastVal > 0 ? (thisVal - lastVal) / lastVal : null;
      const share = thisTotal > 0 ? thisVal / thisTotal : 0;
      return { ch, thisVal, lastVal, wow, share };
    });
  }, [latestWeek, prevWeek]);

  // ---------- Tests Gate ----------
  const tests = useMemo(() => runTests(weeks, channelMetric, deltas), [weeks, channelMetric, deltas]);
  const allPass = tests.every((t) => t.pass);

  // ---------- Handlers ----------
  const updateWeekField = (i, path, value) => {
    setWeeks((cur) => {
      const next = [...cur];
      const w = { ...next[i], kpi: { ...next[i].kpi }, channels: { ...next[i].channels } };
      // path: "endISO" | "kpi.revenue" | "channels.paid"
      const parts = path.split(".");
      if (parts.length === 1) {
        w[parts[0]] = value;
      } else if (parts[0] === "kpi") {
        w.kpi[parts[1]] = toNum(value);
      } else if (parts[0] === "channels") {
        w.channels[parts[1]] = toNum(value);
      }
      next[i] = w;
      return next;
    });
  };

  const addWeek = () => {
    setWeeks((cur) => {
      const last = cur[cur.length - 1];
      const nextEnd = addDays(new Date(last.endISO + "T00:00:00Z"), 7);
      return [
        ...cur.slice(1),
        {
          endISO: toISODate(nextEnd),
          kpi: { ...last.kpi },
          channels: { ...last.channels },
        },
      ];
    });
  };

  const copyJSON = async () => {
    const payload = {
      weeks,
      channelMetric,
      alertThreshold,
      logicVersion,
      audit: { docId, hashHex },
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    toast("JSON copied to clipboard");
  };

  const copyMarkdown = async () => {
    const md = buildMarkdown(weeks, kpiKeys, deltas, alertThreshold, channelMetric, docId, hashHex);
    await navigator.clipboard.writeText(md);
    toast("Markdown summary copied to clipboard");
  };

  // ---------- UI ----------
  return (
    <div className={`min-h-screen w-full ${present ? "bg-white" : "bg-slate-50"}`}>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pipeline Scoreboard — Real Estate WBR</h1>
            <p className="text-sm text-slate-600 mt-1">
              Weekly Branch Review. Tracks lead gen → viewings → offers → deals. CAC inverted for deltas. Channel table labelled by selected metric.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge>docId: {docId}</Badge>
              <Badge>hash: {hashHex.slice(0, 12)}…</Badge>
              {baseline && <Badge title={`Baseline @ ${baseline.ts}`}>baseline set</Badge>}
              {lastRun && <Badge>lastRun: {new Date(lastRun).toLocaleString()}</Badge>}
              <Badge>logicVersion: {logicVersion}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm">Present</label>
            <Switch checked={present} onChange={setPresent} />
          </div>
        </div>

        {/* Controls (hidden in Present) */}
        {!present && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="p-3 bg-white rounded-2xl shadow-sm border">
              <label className="text-xs text-slate-500">Channel Metric</label>
              <select
                className="mt-1 w-full rounded-xl border px-2 py-1 text-sm"
                value={channelMetric}
                onChange={(e) => setChannelMetric(e.target.value)}
              >
                <option value="revenue">revenue</option>
                <option value="orders">orders</option>
                <option value="sessions">sessions</option>
              </select>
            </div>
            <div className="p-3 bg-white rounded-2xl shadow-sm border">
              <label className="text-xs text-slate-500">Alert Threshold (|WoW| ≥ …)</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range"
                  min={0.05}
                  max={0.3}
                  step={0.01}
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(parseFloat(e.target.value))}
                  className="w-full"
                />
                <span className="text-sm tabular-nums w-12 text-right">{(alertThreshold * 100).toFixed(0)}%</span>
              </div>
            </div>
            <div className="p-3 bg-white rounded-2xl shadow-sm border">
              <label className="text-xs text-slate-500">Logic Version</label>
              <input
                className="mt-1 w-full rounded-xl border px-2 py-1 text-sm"
                value={logicVersion}
                onChange={(e) => setLogicVersion(e.target.value)}
              />
            </div>
            <div className="p-3 bg-white rounded-2xl shadow-sm border flex items-end justify-between gap-2">
              <button onClick={copyMarkdown} className="btn">Copy Markdown</button>
              <button onClick={copyJSON} className="btn">Copy JSON</button>
            </div>
          </div>
        )}

        {/* Tests Gate */}
        {!present && (
          <div className={`mt-4 p-4 rounded-2xl border ${allPass ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
            <div className="flex items-center justify-between">
              <div className="font-semibold">Tests Gate</div>
              <div className={`text-xs px-2 py-1 rounded-full ${allPass ? "bg-emerald-600 text-white" : "bg-amber-600 text-white"}`}>
                {allPass ? "PASS" : "CHECK"}
              </div>
            </div>
            <ul className="mt-2 grid md:grid-cols-2 gap-1 text-sm">
              {tests.map((t, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className={`mt-1 inline-block h-2 w-2 rounded-full ${t.pass ? "bg-emerald-600" : "bg-amber-600"}`} />
                  <span>
                    <span className="font-medium">{t.name}:</span> {t.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* KPI Cards */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiKeys.map((meta) => {
            const key = meta.key;
            const latest = latestWeek.kpi[key];
            const prev = prevWeek ? prevWeek.kpi[key] : undefined;
            const delta = prevWeek ? deltas[key][deltas[key].length - 1] : null;
            const isAnom = prevWeek ? anomalies[key][anomalies[key].length - 1] : false;
            return (
              <div key={key} className={`p-4 rounded-2xl border bg-white shadow-sm ${isAnom ? "ring-2 ring-rose-400" : ""}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-500">{meta.label} <span className="text-slate-400">{meta.sub}</span></div>
                    <div className="text-2xl font-bold tabular-nums">{meta.fmt(latest)}</div>
                  </div>
                  <DeltaPill delta={delta} invert={key === "cac"} />
                </div>
                <div className="mt-3">
                  <Sparkline values={series[key]} height={36} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Channel Table */}
        <div className="mt-6 bg-white border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="font-semibold">Channel Mix — {channelMetric}</div>
            <div className="text-xs text-slate-500">Week ending {latestWeek.endISO}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2">Channel</th>
                  <th className="text-right px-4 py-2">This</th>
                  <th className="text-right px-4 py-2">Last</th>
                  <th className="text-right px-4 py-2">WoW</th>
                  <th className="text-right px-4 py-2">Share</th>
                </tr>
              </thead>
              <tbody>
                {channelRows.map((r) => (
                  <tr key={r.ch} className="border-t">
                    <td className="px-4 py-2 capitalize">{r.ch}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInteger(r.thisVal)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{fmtInteger(r.lastVal)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <DeltaInline delta={r.wow} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtPct(r.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* History Editor (hidden in Present) */}
        {!present && (
          <div className="mt-6 bg-white border rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="font-semibold">History Editor — 8 Weeks</div>
              <div className="flex items-center gap-2">
                <button className="btn" onClick={addWeek} title="Roll forward one week">+ Add Next Week (roll)</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs md:text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-2 text-left">End (ISO)</th>
                    <th className="px-2 py-2 text-right">Revenue</th>
                    <th className="px-2 py-2 text-right">Deals</th>
                    <th className="px-2 py-2 text-right">Active/Viewings</th>
                    <th className="px-2 py-2 text-right">CAC</th>
                    <th className="px-2 py-2 text-right">Paid</th>
                    <th className="px-2 py-2 text-right">Organic</th>
                    <th className="px-2 py-2 text-right">Email</th>
                    <th className="px-2 py-2 text-right">Referral</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1">
                        <input
                          value={w.endISO}
                          onChange={(e) => updateWeekField(i, "endISO", e.target.value)}
                          className="w-32 rounded-md border px-2 py-1"
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <NumInput value={w.kpi.revenue} onChange={(v) => updateWeekField(i, "kpi.revenue", v)} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <NumInput value={w.kpi.orders} onChange={(v) => updateWeekField(i, "kpi.orders", v)} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <NumInput value={w.kpi.active} onChange={(v) => updateWeekField(i, "kpi.active", v)} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <NumInput value={w.kpi.cac} onChange={(v) => updateWeekField(i, "kpi.cac", v)} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <NumInput value={w.channels.paid} onChange={(v) => updateWeekField(i, "channels.paid", v)} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <NumInput value={w.channels.organic} onChange={(v) => updateWeekField(i, "channels.organic", v)} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <NumInput value={w.channels.email} onChange={(v) => updateWeekField(i, "channels.email", v)} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <NumInput value={w.channels.referral} onChange={(v) => updateWeekField(i, "channels.referral", v)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="h-8" />
      </div>

      {/* Toast container */}
      <div id="toast-root" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50" />

      {/* Styles for buttons/badges/switch */}
      <style>{`
        .btn { @apply rounded-xl border px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50 active:scale-[0.99]; }
      `}</style>
    </div>
  );
}

// ---------- Components ----------
function Badge({ children, title }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-xs border">
      {children}
    </span>
  );
}

function Switch({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition border ${
        checked ? "bg-emerald-500 border-emerald-600" : "bg-slate-200 border-slate-300"
      }`}
      aria-pressed={checked}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${checked ? "translate-x-5" : "translate-x-1"}`}
      />
    </button>
  );
}

function DeltaPill({ delta, invert }) {
  if (delta == null) return <span className="text-xs text-slate-400">—</span>;
  const up = delta >= 0;
  const good = invert ? !up : up;
  return (
    <span
      className={`text-xs px-2 py-1 rounded-full tabular-nums ${
        good ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
      }`}
    >
      {fmtPct(delta)}
    </span>
  );
}

function DeltaInline({ delta }) {
  if (delta == null) return <span className="text-slate-400">—</span>;
  const up = delta >= 0;
  return <span className={`font-medium ${up ? "text-emerald-700" : "text-rose-700"}`}>{fmtPct(delta)}</span>;
}

function Sparkline({ values, width = 220, height = 40, strokeWidth = 2 }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const norm = values.map((v) => (max - min === 0 ? 0.5 : (v - min) / (max - min)));
  const pts = norm.map((n, i) => {
    const x = (i / (values.length - 1)) * (width - 8) + 4;
    const y = height - 4 - n * (height - 8);
    return `${x},${y}`;
  });
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts.join(" ")} fill="none" strokeWidth={strokeWidth} stroke="currentColor" className="text-slate-700" />
    </svg>
  );
}

function NumInput({ value, onChange }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(toNum(e.target.value))}
      className="w-24 rounded-md border px-2 py-1 text-right tabular-nums"
      inputMode="decimal"
    />
  );
}

// ---------- Tests ----------
function runTests(weeks, channelMetric, deltas) {
  const tests = [];
  // Test 1: All week.kpi finite
  const allFinite = weeks.every((w) => isFiniteNum(w.kpi.revenue) && isFiniteNum(w.kpi.orders) && isFiniteNum(w.kpi.active) && isFiniteNum(w.kpi.cac));
  tests.push({ name: "KPI finiteness", pass: allFinite, message: allFinite ? "All KPI values are finite across 8 weeks." : "Found non-finite KPI values." });

  // Test 2: channelMetric provided
  const metricProvided = Boolean(channelMetric);
  tests.push({ name: "Channel metric set", pass: metricProvided, message: metricProvided ? `metric=${channelMetric}` : "channelMetric missing" });

  // Test 3: channel values finite; sum(channels) > 0 for each week
  const channelsOk = weeks.every((w) => {
    const vals = Object.values(w.channels);
    return vals.every(isFiniteNum) && vals.reduce((a, b) => a + b, 0) > 0;
  });
  tests.push({ name: "Channel data", pass: channelsOk, message: channelsOk ? "All channel rows valid." : "Channel values must be finite and sum > 0." });

  // Test 4: WoW math finite where last>0; last==0 => null (implicit in logic)
  const wowOk = Object.values(deltas).every((arr) => arr.slice(1).every((d) => d == null || isFiniteNum(d)));
  tests.push({ name: "WoW computation", pass: wowOk, message: wowOk ? "WoW finite or null per rule." : "WoW contains invalid numbers." });

  return tests;
}

// ---------- Utils ----------
function isFiniteNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function toNum(v) {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^\d.\-]/g, "")) : v;
  return Number.isFinite(n) ? n : 0;
}

function fmtCurrency(n) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n || 0);
}

function fmtInteger(n) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n || 0);
}

function fmtPct(x) {
  return x == null ? "—" : `${(x * 100).toFixed(0)}%`;
}

function sumChannels(ch) {
  return (ch.paid || 0) + (ch.organic || 0) + (ch.email || 0) + (ch.referral || 0);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toISODate(d) {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${d.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ensureDocId() {
  const key = "wbr_doc_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `wbr-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function loadBaseline() {
  try {
    const raw = localStorage.getItem("wbr_baseline");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveBaseline(b) {
  try {
    localStorage.setItem("wbr_baseline", JSON.stringify(b));
  } catch {}
}

function loadLastRun() {
  try {
    return localStorage.getItem("wbr_last_run");
  } catch {
    return null;
  }
}

function saveLastRun(ts) {
  try {
    localStorage.setItem("wbr_last_run", ts);
  } catch {}
}

async function canonicalHash(obj) {
  const canonical = canonicalize(obj);
  const enc = new TextEncoder().encode(canonical);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalize(x) {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map((v) => canonicalize(v)).join(",")}]`;
  const keys = Object.keys(x).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(x[k])}`).join(",")}}`;
}

function toast(msg) {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const el = document.createElement("div");
  el.className = "mt-2 rounded-xl bg-slate-900 text-white text-sm px-3 py-2 shadow-lg";
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(4px)";
    el.style.transition = "all 300ms";
    setTimeout(() => el.remove(), 350);
  }, 1200);
}

function buildMarkdown(weeks, kpiKeys, deltas, alertThreshold, channelMetric, docId, hashHex) {
  const latest = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  const lines = [];
  lines.push(`# Pipeline Scoreboard — Real Estate WBR`);
  lines.push("");
  lines.push(`**Week ending ${latest.endISO}**  `);
  lines.push(`docId: ${docId}  `);
  lines.push(`hash: ${hashHex}`);
  lines.push("");
  lines.push(`Alert threshold: ${(alertThreshold * 100).toFixed(0)}%  `);
  lines.push(`Channel metric: ${channelMetric}`);
  lines.push("");
  lines.push(`## KPIs`);
  lines.push("\n| KPI | This | WoW |\n|---|---:|---:|");
  kpiKeys.forEach((meta) => {
    const thisVal = latest.kpi[meta.key];
    const d = prev ? deltas[meta.key][deltas[meta.key].length - 1] : null;
    lines.push(`| ${meta.label} ${meta.sub} | ${meta.fmt(thisVal)} | ${d == null ? "—" : fmtPct(d)} |`);
  });
  lines.push("");
  lines.push(`_WoW rule: if last==0 → delta=null (render “—”); CAC inverted._`);
  return lines.join("\n");
}

