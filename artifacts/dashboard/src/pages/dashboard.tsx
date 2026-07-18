import React, { useEffect, useState, useRef } from "react";
import { useGetBotSummary, useGetBotTrades, getGetBotSummaryQueryKey, getGetBotTradesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, ArrowDownRight, ArrowUpRight, Clock, Coins, Crosshair,
  TrendingUp, Wallet, Zap, Link2, Play, Square, Terminal, Shield, BrainCircuit,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";

// ── Formatters ─────────────────────────────────────────────────────────────
const fmt$ = (val: number | undefined, smart = false) => {
  if (val === undefined || val === null) return "$0.00";
  if (smart && val > 0 && val < 0.01) {
    const sig = Math.ceil(-Math.log10(val)) + 2;
    return "$" + val.toFixed(Math.min(sig, 8));
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(val);
};

const fmtPct = (val: number | undefined) => {
  if (val === undefined || val === null) return "0.00%";
  return `${val > 0 ? "+" : ""}${val.toFixed(2)}%`;
};

const fmtRuntime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};

// ── RSI Bar ────────────────────────────────────────────────────────────────
const RsiBar = ({ value }: { value?: number }) => {
  if (value === undefined) return <span className="text-muted-foreground text-[10px]">warming…</span>;
  const color = value < 38 ? "#39ff14" : value > 62 ? "#ff3b30" : "#facc15";
  const label = value < 38 ? "OVERSOLD" : value > 62 ? "OVERBOUGHT" : "NEUTRAL";
  return (
    <div className="mt-1.5">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span style={{ color }} className="font-display tracking-wider">{label}</span>
        <span className="font-mono text-muted-foreground">RSI {value.toFixed(0)}</span>
      </div>
      <div className="w-full h-0.5 bg-muted/50">
        <div className="h-0.5 transition-all duration-700" style={{ width: `${Math.min(100, value)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
};

// ── Bot state type ─────────────────────────────────────────────────────────
type BotState = {
  running: boolean;
  cycle: number;
  timestamp: string;
  prices: Record<string, number>;
  trends: Record<string, number>;
  rsi: Record<string, number>;
  signals: Record<string, string>;
  wallet: { usdc: number; sol: number; holdings: Record<string, number>; total_value_usdc: number };
  pnl_usd: number;
  pnl_pct: number;
  starting_value: number;
  runtime_seconds: number;
  total_trades: number;
};

const TOKENS = ["SOL", "JUP", "BONK", "WIF"] as const;

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [state, setState] = useState<BotState | null>(null);
  const [liveAge, setLiveAge] = useState(0); // seconds since last successful fetch

  const { data: summary } = useGetBotSummary({ query: { refetchInterval: 5000, queryKey: getGetBotSummaryQueryKey() } });
  const { data: trades, isLoading: tradesLoading } = useGetBotTrades({ query: { refetchInterval: 5000, queryKey: getGetBotTradesQueryKey() } });

  // Local state
  const [controlling, setControlling] = useState(false);
  const [blink, setBlink] = useState(false);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [pnlHistory, setPnlHistory] = useState<{ t: number; pnl: number }[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [insight, setInsight] = useState<string>("");
  const [insightCycle, setInsightCycle] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const insightRef = useRef<HTMLDivElement>(null);
  const prevCycleRef = useRef(0);

  // ── 3-second polling for bot state ───────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch("/api/bot/status");
        if (!r.ok) return;
        const data = await r.json() as BotState;
        setState(data);
        setLiveAge(0);
        if (data.cycle !== prevCycleRef.current) {
          prevCycleRef.current = data.cycle;
          setBlink(true);
          setTimeout(() => setBlink(false), 400);
          setPnlHistory(prev => [...prev, { t: Date.now(), pnl: data.pnl_usd }].slice(-60));
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // ── Staleness ticker ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setLiveAge(a => a + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Runtime counter ──────────────────────────────────────────────────────
  useEffect(() => {
    setLiveSeconds(state?.runtime_seconds ?? 0);
    if (!state?.running) return;
    const id = setInterval(() => setLiveSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [state?.runtime_seconds, state?.running]);

  // ── Bot log poll ─────────────────────────────────────────────────────────
  useEffect(() => {
    const fetch_ = async () => {
      try {
        const r = await fetch("/api/bot/log");
        if (r.ok) { const d = await r.json(); if (Array.isArray(d.lines)) setLogLines(d.lines); }
      } catch {}
    };
    fetch_();
    const id = setInterval(fetch_, 4000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logLines]);

  // ── Tactical Intelligence fetch ──────────────────────────────────────────
  useEffect(() => {
    if (!state?.cycle || state.cycle === insightCycle) return;
    fetch("/api/bot/insight")
      .then(r => r.json())
      .then(d => { setInsight(d.text ?? ""); setInsightCycle(d.cycle ?? state.cycle); })
      .catch(() => {});
  }, [state?.cycle, insightCycle]);

  useEffect(() => { if (insightRef.current) insightRef.current.scrollTop = 0; }, [insight]);

  const invalidateAll = (delay = 2000) => {
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: getGetBotSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetBotTradesQueryKey() });
    }, delay);
  };

  // ── Controls ─────────────────────────────────────────────────────────────
  const handleStart = async () => {
    setControlling(true);
    try {
      const res = await fetch("/api/bot/start", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast({ title: "Bot started", description: "LIVE mode — watch the log and insight panels" });
        invalidateAll(2000);
      } else {
        toast({ title: "Could not start", description: data.message || "Unknown error", variant: "destructive" });
      }
    } catch { toast({ title: "Request failed", description: "Cannot reach API", variant: "destructive" }); }
    finally { setControlling(false); }
  };

  const handleStop = async () => {
    setControlling(true);
    try {
      const res = await fetch("/api/bot/stop", { method: "POST" });
      const data = await res.json();
      toast({ title: data.ok ? "Bot stopped" : "Stop result", description: data.message, variant: data.ok ? "default" : "destructive" });
      invalidateAll(1500);
    } catch { toast({ title: "Request failed", description: "Cannot reach API", variant: "destructive" }); }
    finally { setControlling(false); }
  };

  const isRunning = state?.running ?? false;
  const pnl = state?.pnl_usd ?? 0;
  const pnlPct = state?.pnl_pct ?? 0;
  const pnlPos = pnl >= 0;

  return (
    <div className="min-h-[100dvh] bg-background p-3 md:p-6 text-foreground selection:bg-primary/30">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-primary/20">
          <div>
            <h1 className="text-3xl md:text-4xl font-display font-bold tracking-wider text-primary glow-text uppercase">
              SOL-BOT <span className="text-muted-foreground text-xl">v3.0</span>
            </h1>
            <p className="text-muted-foreground uppercase tracking-widest text-xs mt-1 flex items-center gap-2">
              <Crosshair className="w-3 h-3 text-primary" />
              EMA · RSI · SOL · JUP · BONK · WIF
              <span className={`w-1.5 h-1.5 rounded-full ${liveAge < 6 ? "bg-[#39ff14] animate-pulse" : liveAge < 15 ? "bg-yellow-500" : "bg-destructive"}`} title={`Data updated ${liveAge}s ago`} />
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isRunning ? (
              <button onClick={handleStop} disabled={controlling}
                className="flex items-center gap-2 px-4 py-2 border border-destructive text-destructive font-display text-xs tracking-widest uppercase hover:bg-destructive hover:text-white transition-colors disabled:opacity-50">
                <Square className="w-3 h-3" />{controlling ? "Stopping…" : "Stop Bot"}
              </button>
            ) : (
              <button onClick={handleStart} disabled={controlling}
                className="flex items-center gap-2 px-4 py-2 border border-[#39ff14] text-[#39ff14] font-display text-xs tracking-widest uppercase hover:bg-[#39ff14] hover:text-background transition-colors disabled:opacity-50">
                <Play className="w-3 h-3" />{controlling ? "Starting…" : "Start Bot"}
              </button>
            )}
            <div className="flex items-center gap-2 bg-card border border-primary/30 px-3 py-2 glow-box">
              <Activity className={`w-4 h-4 ${isRunning ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
              <span className="font-display text-sm tracking-widest uppercase">{isRunning ? "SYS.ONLINE" : "SYS.OFFLINE"}</span>
            </div>
            <Badge variant="outline" className="font-display text-xs tracking-widest px-3 py-1 border-destructive text-destructive glow-text-red">LIVE MODE</Badge>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* ── P&L + mini chart ─────────────────────────────────────────── */}
          <Card className="md:col-span-2 bg-card/80 backdrop-blur border-primary/30 glow-box relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10 pointer-events-none"><Zap className="w-24 h-24 text-primary" /></div>
            <CardHeader className="pb-1">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-xs flex items-center gap-2">
                <TrendingUp className="w-3 h-3" /> Global Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-1">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Total P&L</p>
                  <div className={`font-display text-5xl font-bold ${pnlPos ? "text-[#39ff14] glow-text-green" : "text-destructive glow-text-red"} ${blink ? "scale-[1.02]" : "scale-100"} transition-transform duration-200`}>
                    {pnl > 0 ? "+" : ""}{fmt$(pnl)}
                  </div>
                  <div className={`flex items-center gap-1 mt-1 text-sm font-display ${pnlPos ? "text-[#39ff14]" : "text-destructive"}`}>
                    {pnlPos ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    {fmtPct(pnlPct)}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Portfolio</p>
                      <div className="font-display text-lg">{fmt$(state?.wallet?.total_value_usdc)}</div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Started</p>
                      <div className="font-display text-lg text-muted-foreground">{fmt$(state?.starting_value)}</div>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">P&L History</p>
                  <div className="h-28">
                    {pnlHistory.length < 2 ? (
                      <div className="h-full flex items-center justify-center text-muted-foreground text-xs font-display uppercase tracking-widest">
                        {isRunning ? "Collecting data…" : "Start bot to track"}
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={pnlHistory} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                          <defs>
                            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={pnlPos ? "#39ff14" : "#ff3b30"} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={pnlPos ? "#39ff14" : "#ff3b30"} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="t" hide />
                          <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #333", borderRadius: 0, fontSize: 11 }}
                            formatter={(v: number) => [`${v >= 0 ? "+" : ""}${fmt$(v)}`, "P&L"]} labelFormatter={() => ""} />
                          <Area type="monotone" dataKey="pnl" stroke={pnlPos ? "#39ff14" : "#ff3b30"} strokeWidth={1.5} fill="url(#pnlGrad)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Session ──────────────────────────────────────────────────── */}
          <Card className="bg-card/80 backdrop-blur border-primary/20">
            <CardHeader className="pb-1">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-xs flex items-center gap-2">
                <Clock className="w-3 h-3" /> Session
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 mt-1">
                {[
                  ["Runtime", isRunning ? fmtRuntime(liveSeconds) : (state?.runtime_seconds ? fmtRuntime(state.runtime_seconds) : "—")],
                  ["Cycles", String(state?.cycle ?? 0)],
                  ["Trades", String(state?.total_trades ?? summary?.total_trades ?? 0)],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between items-center border-b border-border/50 pb-2">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
                    <span className="font-display text-primary text-sm tabular-nums">{val}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Buys / Sells</span>
                  <span className="font-display text-sm">
                    <span className="text-[#39ff14]">{summary?.buy_count ?? 0}</span>
                    <span className="text-muted-foreground mx-1">/</span>
                    <span className="text-destructive">{summary?.sell_count ?? 0}</span>
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Shield className="w-3 h-3" /> Circuit</span>
                  <span className={`font-display text-xs ${(state?.wallet?.total_value_usdc ?? 20) < 5.5 ? "text-destructive animate-pulse" : "text-[#39ff14]"}`}>
                    {(state?.wallet?.total_value_usdc ?? 20) < 5.5 ? "⚠ NEAR LIMIT" : "OK · $5.00 floor"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Tactical Intelligence Panel ───────────────────────────────── */}
          <Card className="md:col-span-3 border-primary/40 bg-black/60 backdrop-blur glow-box relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
            <CardHeader className="pb-1 border-b border-primary/20">
              <CardTitle className="font-display tracking-widest uppercase text-xs flex items-center gap-2 text-primary">
                <BrainCircuit className="w-4 h-4" />
                Tactical Intelligence // Market Analysis
                {state?.cycle ? (
                  <span className="text-muted-foreground text-[10px] ml-auto tabular-nums">
                    CYCLE {state.cycle} · {new Date(state.timestamp).toLocaleTimeString()}
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div
                ref={insightRef}
                className="h-52 overflow-y-auto p-4 font-mono text-[11px] leading-5 text-primary/80 whitespace-pre-wrap"
              >
                {insight ? insight : (
                  <span className="text-primary/40">
                    {isRunning
                      ? "Waiting for first cycle to complete… strategy will analyze RSI, EMA, trends, and portfolio state."
                      : "Start the bot to activate the tactical intelligence engine."}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Wallet ───────────────────────────────────────────────────── */}
          <Card className="bg-card/80 backdrop-blur border-primary/20">
            <CardHeader className="pb-1">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-xs flex items-center gap-2">
                <Wallet className="w-3 h-3" /> Wallet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 mt-1">
                <div className="flex justify-between items-center p-2 bg-muted/30 border border-border/50">
                  <span className="font-display text-sm text-primary">USDC</span>
                  <span className="font-display text-base">{fmt$(state?.wallet?.usdc)}</span>
                </div>
                {state?.wallet?.sol !== undefined && state.wallet.sol > 0 && (
                  <div className="flex justify-between items-center p-2 border border-border/30">
                    <span className="font-display text-sm">SOL</span>
                    <div className="text-right">
                      <div className="font-display text-sm text-muted-foreground">{state.wallet.sol.toFixed(4)} SOL</div>
                      {state.prices?.["SOL"] && <div className="text-xs text-primary">≈ {fmt$(state.wallet.sol * state.prices["SOL"]!)}</div>}
                    </div>
                  </div>
                )}
                {state?.wallet?.holdings && Object.entries(state.wallet.holdings).map(([tok, amt]) => {
                  const price = state.prices?.[tok];
                  return (
                    <div key={tok} className="flex justify-between items-center p-2 border border-border/30">
                      <span className="font-display text-sm">{tok}</span>
                      <div className="text-right">
                        <div className="font-display text-sm text-muted-foreground">{(amt as number).toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
                        {price && <div className="text-xs text-primary">≈ {fmt$((amt as number) * price)}</div>}
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2 border-t border-border/30 flex justify-between">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Total</span>
                  <span className="font-display text-sm">{fmt$(state?.wallet?.total_value_usdc)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Market Feeds ─────────────────────────────────────────────── */}
          <Card className="md:col-span-2 bg-card/80 backdrop-blur border-primary/20">
            <CardHeader className="pb-1">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-xs flex items-center gap-2">
                <Coins className="w-3 h-3" /> Live Market Feeds
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-1">
                {TOKENS.map(token => {
                  const price = state?.prices?.[token];
                  const trend = state?.trends?.[token] ?? 0;
                  const rsiVal = state?.rsi?.[token];
                  const sig = state?.signals?.[token];
                  const isUp = trend >= 0;
                  return (
                    <div key={token} className="p-3 border border-border/50 bg-background flex flex-col relative overflow-hidden">
                      <div className={`absolute top-0 left-0 w-1 h-full ${isUp ? "bg-[#39ff14]" : "bg-destructive"}`} />
                      <div className="flex items-start justify-between mb-1">
                        <span className="font-display text-muted-foreground uppercase tracking-widest text-xs">{token}</span>
                        {sig && sig !== "HOLD" && sig !== "WARMING" && (
                          <Badge variant="outline" className={`text-[10px] px-1 py-0 rounded-none font-display ${sig === "BUY" ? "bg-[#39ff14]/20 text-[#39ff14] border-[#39ff14]" : "bg-destructive/20 text-destructive border-destructive"}`}>
                            {sig}
                          </Badge>
                        )}
                      </div>
                      {price !== undefined ? (
                        <span className={`font-display text-lg font-bold ${blink ? "text-primary" : "text-foreground"} transition-colors duration-300`}>
                          {fmt$(price, true)}
                        </span>
                      ) : (
                        <span className="font-display text-lg text-muted-foreground">—</span>
                      )}
                      <span className={`text-xs mt-0.5 flex items-center gap-0.5 ${isUp ? "text-[#39ff14]" : "text-destructive"}`}>
                        {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {fmtPct(trend)}
                      </span>
                      <RsiBar value={rsiVal} />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* ── Bot Log ──────────────────────────────────────────────────── */}
          <Card className="md:col-span-3 bg-card/80 backdrop-blur border-primary/20">
            <CardHeader className="pb-1 border-b border-border/50">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-xs flex items-center gap-2">
                <Terminal className="w-3 h-3" /> Bot Log
                {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-[#39ff14] animate-pulse" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div ref={logRef} className="h-36 overflow-y-auto p-3 font-mono text-[11px] leading-5 bg-black/40 text-muted-foreground">
                {logLines.length === 0
                  ? <span className="text-muted-foreground/40">No output yet. Start the bot.</span>
                  : logLines.map((line, i) => {
                      const color = line.includes("[ERROR]") || line.includes("❌") ? "text-destructive"
                        : line.includes("BUY") ? "text-[#39ff14]"
                        : line.includes("SELL") ? "text-yellow-400"
                        : line.includes("[WARNING]") ? "text-yellow-500"
                        : "text-muted-foreground";
                      return <div key={i} className={`${color} whitespace-pre-wrap break-all`}>{line}</div>;
                    })
                }
              </div>
            </CardContent>
          </Card>

          {/* ── Trade History ─────────────────────────────────────────────── */}
          <Card className="md:col-span-3 bg-card/80 backdrop-blur border-primary/30">
            <CardHeader className="pb-1 border-b border-border/50">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-xs flex items-center gap-2">
                <Activity className="w-3 h-3" /> Execution Log
                <span className="text-muted-foreground/50 text-[10px]">({trades?.length ?? 0} trades)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-56">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 backdrop-blur">
                    <TableRow className="border-border/50 hover:bg-transparent">
                      {["Time", "Action", "Asset", "Price", "Signal", "Tx"].map(h => (
                        <TableHead key={h} className={`font-display uppercase tracking-widest text-[10px] text-muted-foreground ${h === "Price" || h === "Tx" ? "text-right" : ""}`}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tradesLoading ? (
                      Array(3).fill(0).map((_, i) => (
                        <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8 w-full bg-primary/10" /></TableCell></TableRow>
                      ))
                    ) : !trades?.length ? (
                      <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground font-display uppercase tracking-widest text-xs">No executions yet</TableCell></TableRow>
                    ) : (
                      [...trades].reverse().map((trade, i) => (
                        <TableRow key={i} className="border-border/30 hover:bg-primary/5 transition-colors">
                          <TableCell className="font-mono text-[11px] text-muted-foreground">{new Date(trade.timestamp).toLocaleTimeString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`font-display text-[10px] px-1.5 rounded-none border ${trade.action === "BUY" ? "text-[#39ff14] border-[#39ff14]" : "text-destructive border-destructive"}`}>
                              {trade.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-display font-medium text-xs">{trade.token}</TableCell>
                          <TableCell className="font-display text-right text-xs">{fmt$(trade.price_usdc, true)}</TableCell>
                          <TableCell className="text-[11px] text-muted-foreground max-w-[160px] truncate" title={trade.reason}>{trade.reason || "AUTO"}</TableCell>
                          <TableCell className="text-right">
                            {trade.tx_signature
                              ? <a href={`https://solscan.io/tx/${trade.tx_signature}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center p-1 hover:bg-primary/20 rounded text-primary"><Link2 className="w-3 h-3" /></a>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
