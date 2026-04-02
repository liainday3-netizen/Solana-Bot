import React, { useEffect, useState } from "react";
import { useGetBotStatus, useGetBotSummary, useGetBotTrades, getGetBotStatusQueryKey, getGetBotSummaryQueryKey, getGetBotTradesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Activity, ArrowDownRight, ArrowUpRight, Clock, Coins, Crosshair, DollarSign, TrendingUp, Wallet, Zap, Link2, Play, Square } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

const formatCurrency = (val: number | undefined) => {
  if (val === undefined) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(val);
};

const formatPercent = (val: number | undefined) => {
  if (val === undefined) return "0.00%";
  return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2 }).format(val / 100);
};

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: status, isLoading: statusLoading } = useGetBotStatus({ query: { refetchInterval: 5000, queryKey: getGetBotStatusQueryKey() } });
  const { data: summary, isLoading: summaryLoading } = useGetBotSummary({ query: { refetchInterval: 5000, queryKey: getGetBotSummaryQueryKey() } });
  const { data: trades, isLoading: tradesLoading } = useGetBotTrades({ query: { refetchInterval: 5000, queryKey: getGetBotTradesQueryKey() } });

  const { toast } = useToast();
  const [blink, setBlink] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"live" | "paper">("live");

  useEffect(() => {
    setBlink(true);
    const t = setTimeout(() => setBlink(false), 200);
    return () => clearTimeout(t);
  }, [status?.cycle]);

  useEffect(() => {
    if (status?.mode) {
      setSelectedMode(status.mode as "live" | "paper");
    }
  }, [status?.mode]);

  const invalidateStatus = (delay = 2000) => {
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetBotSummaryQueryKey() });
    }, delay);
  };

  const handleStart = async () => {
    setControlling(true);
    try {
      const res = await fetch("/api/bot/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: selectedMode }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast({ title: "Bot started", description: `Running in ${selectedMode.toUpperCase()} mode` });
        invalidateStatus(2000);
      } else {
        toast({ title: "Could not start bot", description: data.message || "Unknown error", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Request failed", description: "Could not reach the API. Check server logs.", variant: "destructive" });
    } finally {
      setControlling(false);
    }
  };

  const handleStop = async () => {
    setControlling(true);
    try {
      const res = await fetch("/api/bot/stop", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast({ title: "Bot stopped", description: data.message });
        invalidateStatus(1500);
      } else {
        toast({ title: "Could not stop bot", description: data.message || "Unknown error", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Request failed", description: "Could not reach the API. Check server logs.", variant: "destructive" });
    } finally {
      setControlling(false);
    }
  };

  const isRunning = status?.running ?? false;

  return (
    <div className="min-h-[100dvh] bg-background p-4 md:p-8 text-foreground selection:bg-primary/30">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-primary/20">
          <div>
            <h1 className="text-4xl md:text-5xl font-display font-bold tracking-wider text-primary glow-text uppercase">
              SOL-BOT <span className="text-muted-foreground text-2xl">v2.0</span>
            </h1>
            <p className="text-muted-foreground uppercase tracking-widest text-sm mt-1 flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-primary" /> Tactical Trading Terminal
            </p>
          </div>
          
          <div className="flex items-center gap-3 flex-wrap">
            {/* Mode Toggle */}
            <div className="flex items-center border border-primary/30 overflow-hidden">
              <button
                onClick={() => setSelectedMode("paper")}
                disabled={isRunning || controlling}
                className={`px-3 py-2 font-display text-xs tracking-widest uppercase transition-colors disabled:opacity-40 ${
                  selectedMode === "paper"
                    ? "bg-primary text-background"
                    : "bg-transparent text-muted-foreground hover:text-primary"
                }`}
              >
                Paper
              </button>
              <button
                onClick={() => setSelectedMode("live")}
                disabled={isRunning || controlling}
                className={`px-3 py-2 font-display text-xs tracking-widest uppercase transition-colors disabled:opacity-40 ${
                  selectedMode === "live"
                    ? "bg-destructive text-white"
                    : "bg-transparent text-muted-foreground hover:text-destructive"
                }`}
              >
                Live
              </button>
            </div>

            {/* Start / Stop Button */}
            {isRunning ? (
              <button
                onClick={handleStop}
                disabled={controlling}
                className="flex items-center gap-2 px-4 py-2 border border-destructive text-destructive font-display text-sm tracking-widest uppercase hover:bg-destructive hover:text-white transition-colors disabled:opacity-50"
              >
                <Square className="w-4 h-4" />
                {controlling ? "Stopping..." : "Stop Bot"}
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={controlling}
                className="flex items-center gap-2 px-4 py-2 border border-[#39ff14] text-[#39ff14] font-display text-sm tracking-widest uppercase hover:bg-[#39ff14] hover:text-background transition-colors disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                {controlling ? "Starting..." : "Start Bot"}
              </button>
            )}

            {/* System Status */}
            <div className="flex items-center gap-2 bg-card border border-primary/30 px-4 py-2 glow-box">
              <Activity className={`w-5 h-5 ${isRunning ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
              <span className="font-display text-lg tracking-widest uppercase">
                {isRunning ? "SYS.ONLINE" : "SYS.OFFLINE"}
              </span>
            </div>

            {status?.mode && (
              <Badge variant="outline" className={`font-display text-sm tracking-widest px-3 py-1 ${status.mode === 'live' ? 'border-destructive text-destructive glow-text-red' : 'border-primary text-primary glow-text'}`}>
                {status.mode.toUpperCase()} MODE
              </Badge>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Main Status & PnL */}
          <Card className="md:col-span-2 bg-card/80 backdrop-blur border-primary/30 glow-box relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
              <Zap className="w-32 h-32 text-primary" />
            </div>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> Global Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mt-2">
                <div>
                  <p className="text-sm text-muted-foreground uppercase tracking-widest mb-1">Total P&L (USD)</p>
                  {statusLoading ? <Skeleton className="h-12 w-32 bg-primary/20" /> : (
                    <div className={`font-display text-5xl font-bold ${status?.pnl_usd && status.pnl_usd >= 0 ? "text-[#39ff14] glow-text-green" : "text-destructive glow-text-red"} ${blink ? 'scale-[1.02]' : 'scale-100'} transition-transform duration-200`}>
                      {status?.pnl_usd && status.pnl_usd > 0 ? "+" : ""}{formatCurrency(status?.pnl_usd)}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-lg font-display ${status?.pnl_pct && status.pnl_pct >= 0 ? "text-[#39ff14]" : "text-destructive"}`}>
                      {status?.pnl_pct && status.pnl_pct > 0 ? <ArrowUpRight className="inline w-5 h-5" /> : <ArrowDownRight className="inline w-5 h-5" />}
                      {formatPercent(status?.pnl_pct)}
                    </span>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground uppercase tracking-widest mb-1">Current Value</p>
                    <div className="font-display text-3xl text-foreground">
                      {formatCurrency(summary?.current_value)}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground uppercase tracking-widest mb-1">Starting Value</p>
                    <div className="font-display text-xl text-muted-foreground">
                      {formatCurrency(summary?.starting_value)}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Session Stats */}
          <Card className="bg-card/80 backdrop-blur border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-sm flex items-center gap-2">
                <Clock className="w-4 h-4" /> Session Telemetry
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 mt-2">
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-sm uppercase tracking-wider text-muted-foreground">Runtime</span>
                  <span className="font-display text-primary">{summary?.runtime_seconds || 0}s</span>
                </div>
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-sm uppercase tracking-wider text-muted-foreground">Cycles</span>
                  <span className="font-display text-primary">{summary?.cycles || 0}</span>
                </div>
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-sm uppercase tracking-wider text-muted-foreground">Total Trades</span>
                  <span className="font-display text-primary">{summary?.total_trades || 0}</span>
                </div>
                <div className="flex justify-between items-center pb-2">
                  <span className="text-sm uppercase tracking-wider text-muted-foreground">Win/Loss</span>
                  <span className="font-display text-foreground">
                    <span className="text-[#39ff14]">{summary?.buy_count || 0}</span> / <span className="text-destructive">{summary?.sell_count || 0}</span>
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Wallet & Holdings */}
          <Card className="bg-card/80 backdrop-blur border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-sm flex items-center gap-2">
                <Wallet className="w-4 h-4" /> Wallet Holdings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 mt-2">
                <div className="flex justify-between items-center p-3 bg-muted/30 border border-border/50">
                  <span className="font-display text-lg tracking-wider text-primary">USDC</span>
                  <span className="font-display text-xl">{formatCurrency(status?.wallet?.usdc)}</span>
                </div>

                {(status?.wallet?.sol !== undefined && status.wallet.sol > 0) && (
                  <div className="flex justify-between items-center p-3 border border-border/30 hover:border-primary/30 transition-colors">
                    <span className="font-display text-lg tracking-wider text-foreground">SOL</span>
                    <div className="text-right">
                      <div className="font-display text-lg text-muted-foreground">
                        {new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(status.wallet.sol)} SOL
                      </div>
                      {status?.prices?.SOL && (
                        <div className="font-display text-sm text-primary">
                          ≈ {formatCurrency(status.wallet.sol * status.prices.SOL)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {status?.wallet?.holdings && Object.entries(status.wallet.holdings).map(([token, amount]) => (
                  <div key={token} className="flex justify-between items-center p-3 border border-border/30 hover:border-primary/30 transition-colors">
                    <span className="font-display text-lg tracking-wider text-foreground">{token}</span>
                    <span className="font-display text-lg text-muted-foreground">{new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(amount)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Market Prices */}
          <Card className="md:col-span-2 bg-card/80 backdrop-blur border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-sm flex items-center gap-2">
                <Coins className="w-4 h-4" /> Live Market Feeds
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
                {status?.prices && Object.entries(status.prices).map(([token, price]) => {
                  const trend = status?.trends?.[token] || 0;
                  const isUp = trend >= 0;
                  return (
                    <div key={token} className="p-4 border border-border/50 bg-background flex flex-col relative overflow-hidden group">
                      <div className={`absolute top-0 left-0 w-1 h-full ${isUp ? 'bg-[#39ff14]' : 'bg-destructive'}`}></div>
                      <span className="font-display text-muted-foreground uppercase tracking-widest text-sm mb-1">{token}/USD</span>
                      <span className={`font-display text-2xl font-bold ${blink ? 'text-primary' : 'text-foreground'} transition-colors duration-300`}>
                        {formatCurrency(price)}
                      </span>
                      <span className={`text-sm mt-1 flex items-center gap-1 ${isUp ? 'text-[#39ff14]' : 'text-destructive'}`}>
                        {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {formatPercent(trend * 100)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Trade History */}
          <Card className="md:col-span-3 bg-card/80 backdrop-blur border-primary/30">
            <CardHeader className="pb-2 border-b border-border/50">
              <CardTitle className="text-muted-foreground font-display tracking-widest uppercase text-sm flex items-center gap-2">
                <Activity className="w-4 h-4" /> Execution Log
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 backdrop-blur">
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="font-display uppercase tracking-widest text-xs text-muted-foreground">Time</TableHead>
                      <TableHead className="font-display uppercase tracking-widest text-xs text-muted-foreground">Action</TableHead>
                      <TableHead className="font-display uppercase tracking-widest text-xs text-muted-foreground">Asset</TableHead>
                      <TableHead className="font-display uppercase tracking-widest text-xs text-muted-foreground text-right">Price</TableHead>
                      <TableHead className="font-display uppercase tracking-widest text-xs text-muted-foreground">Signal</TableHead>
                      <TableHead className="font-display uppercase tracking-widest text-xs text-muted-foreground text-right">Tx</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tradesLoading ? (
                      Array(5).fill(0).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={6}><Skeleton className="h-10 w-full bg-primary/10" /></TableCell>
                        </TableRow>
                      ))
                    ) : trades?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-display uppercase tracking-widest">
                          No recent executions
                        </TableCell>
                      </TableRow>
                    ) : (
                      trades?.map((trade, i) => (
                        <TableRow key={i} className="border-border/30 hover:bg-primary/5 transition-colors">
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {new Date(trade.timestamp).toLocaleTimeString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`font-display text-xs px-2 rounded-none border ${trade.action === 'BUY' ? 'text-[#39ff14] border-[#39ff14]' : 'text-destructive border-destructive'}`}>
                              {trade.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-display font-medium text-foreground">{trade.token}</TableCell>
                          <TableCell className="font-display text-right">{formatCurrency(trade.price_usdc)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={trade.reason}>
                            {trade.reason || 'AUTO'}
                          </TableCell>
                          <TableCell className="text-right">
                            {trade.tx_signature ? (
                              <a href={`https://solscan.io/tx/${trade.tx_signature}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center p-1 hover:bg-primary/20 rounded transition-colors text-primary">
                                <Link2 className="w-4 h-4" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground">-</span>
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
