import React, { useEffect, useState, useRef } from "react";
import { useGetBotStatus, useGetBotSummary, useGetBotTrades, getGetBotStatusQueryKey, getGetBotSummaryQueryKey, getGetBotTradesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Activity, ArrowDownRight, ArrowUpRight, Clock, Coins, Crosshair, DollarSign, TrendingUp, Wallet, Zap, Link2, Play, Square, Terminal, BarChart2, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";

const formatCurrency = (val: number | undefined) => {
  if (val === undefined || val === null) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(val);
};

const formatPercent = (val: number | undefined) => {
  if (val === undefined || val === null) return "0.00%";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(2)}%`;
};

const formatRuntime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const RSI_BAR = ({ value, token }: { value: number | undefined; token: string }) => {
  if (value === undefined) return <span className="text-muted-foreground text-xs">–</span>;
  const pct = Math.min(100, Math.max(0, value));
  const color = value < 38 ? "#39ff14" : value > 62 ? "#ff3b30" : "#facc15";
  const label = value < 38 ? "OVERSOLD" : value > 62 ? "OVERBOUGHT" : "NEUTRAL";
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs mb-1">
        <span style={{ color }} className="font-display tracking-wider">{label}</span>
        <span className="font-mono text-muted-foreground">RSI {value.toFixed(0)}</span>
      </div>
      <div className="w-full h-1 bg-muted/50 rounded-none">
        <div className="h-1 transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
};

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: status, isLoading: statusLoading } = useGetBotStatus({ query: { refetchInterval: 5000, queryKey: getGetBotStatusQueryKey() } });
  const { data: summary, isLoading: summaryLoading } = useGetBotSummary({ query: { refetchInterval: 5000, queryKey: getGetBotSummaryQueryKey() } });
  const { data: trades, isLoading: tradesLoading } = useGetBotTrades({ query: { refetchInterval: 5000, queryKey: getGetBotTradesQueryKey() } });

  const { toast } = useToast();
  const [blink, setBlink] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [pnlHistory, setPnlHistory] = useState<{ t: number; pnl: number }[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Local 1-second tick for runtime counter
  useEffect(() => {
    const base = (summary?.runtime_seconds ?? 0);
    setLiveSeconds(base);
    if (!status?.running) return;
    const id = setInterval(() => setLiveSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [summary?.runtime_seconds, status?.running]);

  // Record P&L history for mini chart
  useEffect(() => {
    if (status?.pnl_usd !== undefined) {
      setPnlHistory(prev => {
        const next = [...prev, { t: Date.now(), pnl: status.pnl_usd as number }].slice(-60);
        return next;
      });
    }
  }, [status?.cycle]);

  // Poll bot log
  useEffect(() => {
    const fetchLog = async () => {
      try {
        const res = await fetch("/api/bot/log");
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.lines)) setLogLines(data.lines);
      } catch {}
    };
    fetchLog();
    const id = setInterval(fetchLog, 4000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  // Blink on new cycle
  useEffect(() => {
    setBlink(true);
    const t = setTimeout(() => setBlink(false), 300);
    return () => clearTimeout(t);
  }, [status?.cycle]);

  const invalidateAll = (delay = 2000) => {
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetBotSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetBotTradesQueryKey() });
    }, delay);
  };

  const handleStart = async () => {
    setControlling(true);
    try {
      const res = await fetch("/api/bot/start", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast({ title: "Bot started", description: "Running in LIVE mode — watch the log panel" });
        invalidateAll(2000);
      } else {
        toast({ title: "Could not start bot", description: data.message || "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Request failed", description: "Could not reach the API.", variant: "destructive" });
    } finally {
      setControlling(false);
    }
  };

  const handleStop = async () => {
    setControlling(true);
    try {
      const res = await fetch("/api/bot/stop", { method: "POST" });
      const data = await res.json();
      toast({ title: data.ok ? "Bot stopped" : "Stop result", description: data.message, variant: data.ok ? "default" : "destructive" });
      invalidateAll(1500);
    } catch {
      toast({ title: "Request failed", description: "Could not reach the API.", variant: "destructive" });
    } finally {
      setControlling(false);
    }
  };

  const isRunning = status?.running ?? false;
  const pnl = (status?.pnl_usd as number) ?? 0;
  const pnlPct = (status?.pnl_pct as number) ?? 0;
  const pnlPositive = pnl >= 0;
  const rsiData = (status as Record<string, unknown> | undefined)?.["rsi"] as Record<string, number> | undefined;
  const signals = (status as Record<string, unknown> | undefined)?.["signals"] as Record<string, string> | undefined;

  const walletPubKey = import.meta.env.VITE_WALLET_PUBLIC_KEY as string | undefined;

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
              <Crosshair className="w-3 h-3 text-primary" /> EMA + RSI Strategy · SOL · JUP · BONK · WIF
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isRunning ? (
              <button onClick={handleStop} disabled={controlling}
                className="flex items-center gap-2 px-4 py-2 border border-destructive text-destructive font-display text-xs tracking-widest uppercase hover:bg-destructive hover:text-white transition-colors disabled:opacity-50">
                <Square className="w-3 h-3" />{controlling ? "Stopping..." : "Stop Bot"}
              </button>
            ) : (
              <button onClick={handleStart} disabled={controlling}
                className="flex items-center gap-2 px-4 py-2 border border-[#39ff14] text-[#39ff14] font-display text-xs tracking-widest uppercase hover:bg-[#39ff14] hover:text-background transition-colors disabled:opacity-50">
                <Play className="w-3 h-3" />{controlling ? "Starting..." : "Start Bot"}
              </button>
            )}

            <div className="flex items-center gap-2 bg-card border border-primary/30 px-3 py-2 glow-box">
              <Activity className={`w-4 h-4 ${isRunning ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
              <span className="font-display text-sm tracking-widest uppercase">
                {isRunning ? "SYS.ONLINE" : "SYS.OFFLINE"}
              </span>
            </div>

            <Badge variant="outline" className="font-display text-xs tracking-widest px-3 py-1 border-destructive text-destructive glow-text-red">
              LIVE MODE
            </Badge>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* ── P&L + mini chart ─────────────────────────────────────────── */}
          <Card className="md:col-span-2 bg-card/80 backdrop-blur border-primary/30 glow-box relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10 pointer-events-none">
              <Zap className="w-24 h-24 text-primary" />
            </div>
            <CardHeader className="pb-1">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-xs flex items-center gap-2">
                <TrendingUp className="w-3 h-3" /> Global Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-1">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Total P&L</p>
                  {statusLoading ? <Skeleton className="h-12 w-32 bg-primary/20" /> : (
                    <div className={`font-display text-5xl font-bold ${pnlPositive ? "text-[#39ff14] glow-text-green" : "text-destructive glow-text-red"} ${blink ? "scale-[1.02]" : "scale-100"} transition-transform duration-200`}>
                      {pnl > 0 ? "+" : ""}{formatCurrency(pnl)}
                    </div>
                  )}
                  <div className={`flex items-center gap-1 mt-1 text-sm font-display ${pnlPositive ? "text-[#39ff14]" : "text-destructive"}`}>
                    {pnlPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    {formatPercent(pnlPct)}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Portfolio</p>
                      <div className="font-display text-lg text-foreground">{formatCurrency(summary?.current_value)}</div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Started</p>
                      <div className="font-display text-lg text-muted-foreground">{formatCurrency(summary?.starting_value)}</div>
                    </div>
                  </div>
                </div>

                {/* Mini P&L chart */}
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">P&L History</p>
                  <div className="h-28">
                    {pnlHistory.length < 2 ? (
                      <div className="h-full flex items-center justify-center text-muted-foreground text-xs font-display uppercase tracking-widest">
                        {isRunning ? "Collecting data..." : "Start bot to track"}
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={pnlHistory} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                          <defs>
                            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={pnlPositive ? "#39ff14" : "#ff3b30"} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={pnlPositive ? "#39ff14" : "#ff3b30"} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="t" hide />
                          <Tooltip
                            contentStyle={{ background: "#0a0a0a", border: "1px solid #333", borderRadius: 0, fontSize: 11 }}
                            formatter={(v: number) => [`${v >= 0 ? "+" : ""}${formatCurrency(v)}`, "P&L"]}
                            labelFormatter={() => ""}
                          />
                          <Area type="monotone" dataKey="pnl" stroke={pnlPositive ? "#39ff14" : "#ff3b30"} strokeWidth={1.5} fill="url(#pnlGrad)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Session Telemetry ─────────────────────────────────────────── */}
          <Card className="bg-card/80 backdrop-blur border-primary/20">
            <CardHeader className="pb-1">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-xs flex items-center gap-2">
                <Clock className="w-3 h-3" /> Session
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 mt-1">
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Runtime</span>
                  <span className="font-display text-primary text-sm tabular-nums">
                    {isRunning ? formatRuntime(liveSeconds) : (summary?.runtime_seconds ? formatRuntime(summary.runtime_seconds) : "—")}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Cycles</span>
                  <span className="font-display text-primary text-sm">{status?.cycle ?? 0}</span>
                </div>
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Trades</span>
                  <span className="font-display text-primary text-sm">{summary?.total_trades ?? 0}</span>
                </div>
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Buys / Sells</span>
                  <span className="font-display text-sm">
                    <span className="text-[#39ff14]">{summary?.buy_count ?? 0}</span>
                    <span className="text-muted-foreground mx-1">/</span>
                    <span className="text-destructive">{summary?.sell_count ?? 0}</span>
                  </span>
                </div>
                <div className="flex justify-between items-center pb-2">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Circuit
                  </span>
                  <span className={`font-display text-xs ${(summary?.current_value ?? 20) < 5.5 ? "text-destructive animate-pulse" : "text-[#39ff14]"}`}>
                    {(summary?.current_value ?? 20) < 5.5 ? "NEAR LIMIT" : "OK"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Wallet Holdings ──────────────────────────────────────────── */}
          <Card className="bg-card/80 backdrop-blur border-primary/20">
            <CardHeader className="pb-1">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-xs flex items-center gap-2">
                <Wallet className="w-3 h-3" /> Wallet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 mt-1">
                <div className="flex justify-between items-center p-2 bg-muted/30 border border-border/50">
                  <span className="font-display text-sm tracking-wider text-primary">USDC</span>
                  <span className="font-display text-base">{formatCurrency(status?.wallet?.usdc)}</span>
                </div>

                {(status?.wallet?.sol !== undefined && status.wallet.sol > 0) && (
                  <div className="flex justify-between items-center p-2 border border-border/30 hover:border-primary/30 transition-colors">
                    <span className="font-display text-sm tracking-wider text-foreground">SOL</span>
                    <div className="text-right">
                      <div className="font-display text-sm text-muted-foreground">
                        {status.wallet.sol.toFixed(4)} SOL
                      </div>
                      {(status?.prices as Record<string, number> | undefined)?.["SOL"] && (
                        <div className="font-display text-xs text-primary">
                          ≈ {formatCurrency(status.wallet.sol * (status.prices as Record<string, number>)["SOL"]!)}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {status?.wallet?.holdings && Object.entries(status.wallet.holdings).map(([token, amount]) => {
                  const price = (status?.prices as Record<string, number> | undefined)?.[token];
                  return (
                    <div key={token} className="flex justify-between items-center p-2 border border-border/30 hover:border-primary/30 transition-colors">
                      <span className="font-display text-sm tracking-wider text-foreground">{token}</span>
                      <div className="text-right">
                        <div className="font-display text-sm text-muted-foreground">
                          {(amount as number).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                        </div>
                        {price && (
                          <div className="font-display text-xs text-primary">
                            ≈ {formatCurrency((amount as number) * price)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="pt-2 border-t border-border/30">
                  <div className="flex justify-between items-center">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">Total Value</span>
                    <span className="font-display text-sm text-foreground">{formatCurrency(status?.wallet?.total_value_usdc)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Market Feeds with RSI ─────────────────────────────────────── */}
          <Card className="md:col-span-2 bg-card/80 backdrop-blur border-primary/20">
            <CardHeader className="pb-1">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-xs flex items-center gap-2">
                <Coins className="w-3 h-3" /> Live Market Feeds
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-1">
                {(["SOL", "JUP", "BONK", "WIF"] as const).map((token) => {
                  const price = (status?.prices as Record<string, number> | undefined)?.[token];
                  const trend = (status?.trends as Record<string, number> | undefined)?.[token] ?? 0;
                  const rsi = rsiData?.[token];
                  const sig = signals?.[token];
                  const isUp = trend >= 0;
                  return (
                    <div key={token} className="p-3 border border-border/50 bg-background flex flex-col relative overflow-hidden">
                      <div className={`absolute top-0 left-0 w-1 h-full ${isUp ? "bg-[#39ff14]" : "bg-destructive"}`} />
                      <div className="flex items-start justify-between mb-1">
                        <span className="font-display text-muted-foreground uppercase tracking-widest text-xs">{token}</span>
                        {sig && sig !== "HOLD" && sig !== "WARMING" && (
                          <Badge className={`text-[10px] px-1 py-0 rounded-none font-display ${sig === "BUY" ? "bg-[#39ff14]/20 text-[#39ff14] border-[#39ff14]" : "bg-destructive/20 text-destructive border-destructive"}`} variant="outline">
                            {sig}
                          </Badge>
                        )}
                      </div>
                      {price !== undefined ? (
                        <span className={`font-display text-lg font-bold ${blink ? "text-primary" : "text-foreground"} transition-colors duration-300`}>
                          {formatCurrency(price)}
                        </span>
                      ) : (
                        <span className="font-display text-lg text-muted-foreground">—</span>
                      )}
                      <span className={`text-xs mt-0.5 flex items-center gap-0.5 ${isUp ? "text-[#39ff14]" : "text-destructive"}`}>
                        {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {formatPercent(trend)}
                      </span>
                      <RSI_BAR value={rsi} token={token} />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* ── Live Bot Log ──────────────────────────────────────────────── */}
          <Card className="md:col-span-3 bg-card/80 backdrop-blur border-primary/20">
            <CardHeader className="pb-1 border-b border-border/50">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-xs flex items-center gap-2">
                <Terminal className="w-3 h-3" /> Bot Log
                {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-[#39ff14] animate-pulse" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div
                ref={logRef}
                className="h-40 overflow-y-auto p-3 font-mono text-[11px] leading-5 bg-black/40 text-muted-foreground"
              >
                {logLines.length === 0 ? (
                  <span className="text-muted-foreground/50">No log output yet. Start the bot to see activity.</span>
                ) : logLines.map((line, i) => {
                  const isError = line.includes("[ERROR]") || line.includes("❌");
                  const isInfo  = line.includes("[INFO]");
                  const isBuy   = line.includes("BUY");
                  const isSell  = line.includes("SELL");
                  const isWarn  = line.includes("[WARNING]") || line.includes("⚠️");
                  const color = isError ? "text-destructive" : isBuy ? "text-[#39ff14]" : isSell ? "text-yellow-400" : isWarn ? "text-yellow-500" : "text-muted-foreground";
                  return (
                    <div key={i} className={`${color} whitespace-pre-wrap break-all`}>{line}</div>
                  );
                })}
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
              <ScrollArea className="h-64">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 backdrop-blur">
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="font-display uppercase tracking-widest text-[10px] text-muted-foreground">Time</TableHead>
                      <TableHead className="font-display uppercase tracking-widest text-[10px] text-muted-foreground">Action</TableHead>
                      <TableHead className="font-display uppercase tracking-widest text-[10px] text-muted-foreground">Asset</TableHead>
                      <TableHead className="font-display uppercase tracking-widest text-[10px] text-muted-foreground text-right">Price</TableHead>
                      <TableHead className="font-display uppercase tracking-widest text-[10px] text-muted-foreground hidden md:table-cell">Signal</TableHead>
                      <TableHead className="font-display uppercase tracking-widest text-[10px] text-muted-foreground text-right">Tx</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tradesLoading ? (
                      Array(3).fill(0).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={6}><Skeleton className="h-8 w-full bg-primary/10" /></TableCell>
                        </TableRow>
                      ))
                    ) : !trades || trades.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-20 text-center text-muted-foreground font-display uppercase tracking-widest text-xs">
                          No executions yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      [...(trades ?? [])].reverse().map((trade, i) => (
                        <TableRow key={i} className="border-border/30 hover:bg-primary/5 transition-colors">
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {new Date(trade.timestamp).toLocaleTimeString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`font-display text-[10px] px-1.5 rounded-none border ${trade.action === "BUY" ? "text-[#39ff14] border-[#39ff14]" : "text-destructive border-destructive"}`}>
                              {trade.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-display font-medium text-foreground text-xs">{trade.token}</TableCell>
                          <TableCell className="font-display text-right text-xs">{formatCurrency(trade.price_usdc)}</TableCell>
                          <TableCell className="text-[11px] text-muted-foreground max-w-[180px] truncate hidden md:table-cell" title={trade.reason}>
                            {trade.reason || "AUTO"}
                          </TableCell>
                          <TableCell className="text-right">
                            {trade.tx_signature ? (
                              <a href={`https://solscan.io/tx/${trade.tx_signature}`} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center justify-center p-1 hover:bg-primary/20 rounded transition-colors text-primary">
                                <Link2 className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
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
