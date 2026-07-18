import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec, spawn } from "child_process";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const BOT_STATE_FILE = path.join(WORKSPACE_ROOT, "solana-bot/bot_state.json");
const TRADES_FILE    = path.join(WORKSPACE_ROOT, "solana-bot/trades.json");
const BOT_PID_FILE   = path.join(WORKSPACE_ROOT, "solana-bot/.bot.pid");
const BOT_LOG_FILE   = path.join(WORKSPACE_ROOT, "solana-bot/bot.log");
const BOT_DIR        = path.join(WORKSPACE_ROOT, "solana-bot");

console.log(`[bot] WORKSPACE_ROOT = ${WORKSPACE_ROOT}`);
console.log(`[bot] BOT_DIR        = ${BOT_DIR}`);

// ── SSE client registry ────────────────────────────────────────────────────
type SseClient = { id: number; res: import("express").Response };
let sseClients: SseClient[] = [];
let sseClientId = 0;

function broadcastState(state: unknown) {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  sseClients.forEach(c => { try { c.res.write(payload); } catch {} });
}

// Watch bot_state.json and push to SSE clients on every change
let fsWatcher: fs.FSWatcher | null = null;
function ensureWatcher() {
  if (fsWatcher) return;
  const watchTarget = path.dirname(BOT_STATE_FILE);
  try {
    fsWatcher = fs.watch(watchTarget, (event, filename) => {
      if (filename !== "bot_state.json") return;
      const state = readJson(BOT_STATE_FILE);
      if (state) broadcastState(state);
    });
  } catch {}
}
ensureWatcher();

// ── Startup cleanup ────────────────────────────────────────────────────────
function killAllBotProcesses(): Promise<void> {
  return new Promise((resolve) => {
    exec("pkill -9 -f 'bot.py'", () => {
      try { fs.unlinkSync(BOT_PID_FILE); } catch {}
      resolve();
    });
  });
}

killAllBotProcesses().then(() => {
  console.log("[bot] Cleared any leftover bot processes on startup");
});

// ── Helpers ────────────────────────────────────────────────────────────────
function readJson(filePath: string): unknown {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isBotRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    exec("pgrep -f 'bot.py'", (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
}

// ── Tactical Intelligence Engine ───────────────────────────────────────────
function generateInsight(state: Record<string, unknown>): string {
  const prices  = (state["prices"]  ?? {}) as Record<string, number>;
  const trends  = (state["trends"]  ?? {}) as Record<string, number>;
  const rsi     = (state["rsi"]     ?? {}) as Record<string, number>;
  const signals = (state["signals"] ?? {}) as Record<string, string>;
  const wallet  = (state["wallet"]  ?? {}) as Record<string, unknown>;
  const pnl     = (state["pnl_usd"] as number) ?? 0;
  const pnlPct  = (state["pnl_pct"] as number) ?? 0;
  const cycle   = (state["cycle"]   as number) ?? 0;
  const runtime = (state["runtime_seconds"] as number) ?? 0;
  const total   = (wallet["total_value_usdc"] as number) ?? 20;
  const usdc    = (wallet["usdc"] as number) ?? 20;
  const starting = (state["starting_value"] as number) ?? 20;

  const tokens = ["SOL", "JUP", "BONK", "WIF"];
  const lines: string[] = [];

  // ── Portfolio overview ──────────────────────────────────────────────────
  const bufferPct = ((total - 5) / total * 100).toFixed(0);
  const riskLevel = total < 7 ? "CRITICAL" : total < 10 ? "HIGH" : total < 15 ? "MODERATE" : "LOW";
  const riskColor = total < 7 ? "🔴" : total < 10 ? "🟠" : total < 15 ? "🟡" : "🟢";

  const mins = Math.floor(runtime / 60);
  const secs = Math.floor(runtime % 60);
  const rtStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  lines.push(`▶ CYCLE ${cycle} · RUNTIME ${rtStr} · PORTFOLIO $${total.toFixed(4)} USDC`);
  lines.push(`  P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)} (${pnl >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%) · USDC LIQUID: $${usdc.toFixed(2)} · RISK ${riskColor} ${riskLevel} · CIRCUIT BUFFER: ${bufferPct}%`);
  lines.push("");

  // ── Per-token tactical read ─────────────────────────────────────────────
  for (const token of tokens) {
    const price  = prices[token];
    const trend  = trends[token] ?? 0;
    const rsiVal = rsi[token];
    const sig    = signals[token];

    if (price === undefined) {
      lines.push(`  ${token.padEnd(4)} │ PRICE FEED OFFLINE — Jupiter + CoinGecko unreachable`);
      continue;
    }

    const trendStr = `${trend >= 0 ? "+" : ""}${trend.toFixed(2)}%`;
    const rsiStr   = rsiVal !== undefined ? `RSI ${rsiVal.toFixed(0)}` : "RSI warming";

    let trendRead = "";
    if (Math.abs(trend) < 0.1)    trendRead = "FLAT — no directional momentum";
    else if (trend > 2)            trendRead = "STRONG UPTREND — aggressive bullish momentum";
    else if (trend > 0.5)          trendRead = "UPTREND — moderate bullish bias";
    else if (trend > 0)            trendRead = "WEAK BULLISH — marginal upward drift";
    else if (trend < -2)           trendRead = "STRONG DOWNTREND — aggressive bearish momentum";
    else if (trend < -0.5)         trendRead = "DOWNTREND — moderate bearish pressure";
    else                           trendRead = "WEAK BEARISH — marginal downward drift";

    let rsiRead = "";
    if (rsiVal === undefined)         rsiRead = "insufficient data";
    else if (rsiVal < 20)             rsiRead = "EXTREME OVERSOLD — high-probability bounce zone";
    else if (rsiVal < 38)             rsiRead = "OVERSOLD — mean reversion likely";
    else if (rsiVal < 45)             rsiRead = "mild oversold — cautious accumulation";
    else if (rsiVal <= 55)            rsiRead = "neutral zone — no extreme positioning";
    else if (rsiVal < 62)             rsiRead = "mild overbought — monitor for reversal";
    else if (rsiVal < 80)             rsiRead = "OVERBOUGHT — distribution zone";
    else                              rsiRead = "EXTREME OVERBOUGHT — high reversal risk";

    let action = "HOLD";
    if (sig === "BUY")  action = "▲ BUY SIGNAL FIRED";
    if (sig === "SELL") action = "▼ SELL SIGNAL FIRED";
    if (sig === "WARMING") action = "WARMING UP";

    lines.push(`  ${token.padEnd(4)} │ $${price < 0.001 ? price.toFixed(8) : price.toFixed(4)} · EMA ${trendStr} · ${rsiStr} · ${action}`);
    lines.push(`       │ Trend: ${trendRead}`);
    lines.push(`       │ RSI:   ${rsiRead}`);
  }

  lines.push("");

  // ── Strategic commentary ────────────────────────────────────────────────
  const activeSigs = tokens.filter(t => signals[t] === "BUY" || signals[t] === "SELL");
  const buySigs    = tokens.filter(t => signals[t] === "BUY");
  const sellSigs   = tokens.filter(t => signals[t] === "SELL");

  if (activeSigs.length === 0) {
    const warmingCount = tokens.filter(t => signals[t] === "WARMING").length;
    if (warmingCount > 0) {
      lines.push(`  STRATEGY · Collecting price history (${14 - warmingCount}/14 cycles complete). First signals expected after cycle 14.`);
    } else {
      lines.push(`  STRATEGY · Markets consolidating. EMA/RSI conditions do not meet entry thresholds. Bot in capital preservation mode.`);
    }
  } else {
    if (buySigs.length > 0) {
      lines.push(`  STRATEGY · Entry signals on ${buySigs.join(", ")} — bot executing long positions. EMA + RSI confirmation achieved.`);
    }
    if (sellSigs.length > 0) {
      lines.push(`  STRATEGY · Exit signals on ${sellSigs.join(", ")} — bot reducing exposure. Profit-taking or stop-loss triggered.`);
    }
  }

  // Drawdown warning
  if (pnl < -1) {
    lines.push(`  WARNING  · Drawdown of $${Math.abs(pnl).toFixed(4)} detected. Circuit breaker at $5.00 — $${(total - 5).toFixed(2)} remaining buffer.`);
  }

  // Session performance
  if (cycle > 20 && pnlPct !== 0) {
    const annualized = (pnlPct / runtime) * 86400 * 365;
    lines.push(`  PERF     · Annualised rate: ${annualized >= 0 ? "+" : ""}${annualized.toFixed(0)}% (extrapolated from session data — not a guarantee).`);
  }

  return lines.join("\n");
}

// ── Routes ─────────────────────────────────────────────────────────────────

// Real-time SSE stream — dashboard connects once, gets pushed on every bot cycle
router.get("/bot/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const id = ++sseClientId;
  sseClients.push({ id, res });

  // Send current state immediately
  const state = readJson(BOT_STATE_FILE);
  if (state) res.write(`data: ${JSON.stringify(state)}\n\n`);

  // Heartbeat to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(": ping\n\n"); } catch {}
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(c => c.id !== id);
  });
});

router.get("/bot/status", async (_req, res) => {
  const state = readJson(BOT_STATE_FILE) as Record<string, unknown> | null;
  const running = await isBotRunning();
  if (!state) {
    return res.json({
      running, mode: "live", cycle: 0, timestamp: new Date().toISOString(),
      prices: {}, wallet: { usdc: 0, sol: 0, holdings: {}, total_value_usdc: 0 },
      starting_value: 20, pnl_usd: 0, pnl_pct: 0, total_trades: 0,
      trends: {}, rsi: {}, signals: {},
    });
  }
  res.json({ ...state, running });
});

router.get("/bot/trades", (_req, res) => {
  const trades = readJson(TRADES_FILE);
  if (!Array.isArray(trades)) return res.json([]);
  res.json(trades);
});

router.get("/bot/summary", (_req, res) => {
  const state = readJson(BOT_STATE_FILE) as Record<string, unknown> | null;
  const trades = readJson(TRADES_FILE) as unknown[] | null;
  const tradeList = Array.isArray(trades) ? trades : [];
  const buyCount  = tradeList.filter((t: unknown) => (t as Record<string, unknown>)["action"] === "BUY").length;
  const sellCount = tradeList.filter((t: unknown) => (t as Record<string, unknown>)["action"] === "SELL").length;
  const lastTrade = tradeList[tradeList.length - 1] as Record<string, unknown> | undefined;
  res.json({
    total_trades: tradeList.length,
    runtime_seconds: state?.["runtime_seconds"] ?? 0,
    cycles:          state?.["cycle"] ?? 0,
    starting_value:  state?.["starting_value"] ?? 20,
    current_value:   (state?.["wallet"] as Record<string, unknown> | undefined)?.["total_value_usdc"] ?? 0,
    pnl_usd:         state?.["pnl_usd"] ?? 0,
    pnl_pct:         state?.["pnl_pct"] ?? 0,
    mode:            state?.["mode"] ?? "live",
    buy_count:       buyCount,
    sell_count:      sellCount,
    last_trade_at:   lastTrade?.["timestamp"] ?? null,
  });
});

router.get("/bot/log", (_req, res) => {
  try {
    if (!fs.existsSync(BOT_LOG_FILE)) return res.json({ lines: [] });
    const content = fs.readFileSync(BOT_LOG_FILE, "utf8");
    const lines = content.split("\n").filter(Boolean);
    return res.json({ lines: lines.slice(-100) });
  } catch {
    return res.json({ lines: [] });
  }
});

router.get("/bot/insight", (_req, res) => {
  const state = readJson(BOT_STATE_FILE) as Record<string, unknown> | null;
  if (!state) return res.json({ text: "Waiting for bot to start and collect market data..." });
  const text = generateInsight(state);
  res.json({ text, cycle: state["cycle"], timestamp: state["timestamp"] });
});

router.post("/bot/stop", async (_req, res) => {
  await killAllBotProcesses();
  await new Promise(r => setTimeout(r, 1500));
  const stillRunning = await isBotRunning();
  res.json({ ok: !stillRunning, message: stillRunning ? "Bot may still be running" : "Bot stopped" });
});

router.post("/bot/start", async (_req, res) => {
  const alreadyRunning = await isBotRunning();
  if (alreadyRunning) return res.status(409).json({ ok: false, message: "Bot is already running" });

  const walletKey  = process.env["WALLET_PUBLIC_KEY"];
  const privateKey = process.env["PRIVATE_KEY"];

  if (!walletKey || !privateKey) {
    return res.status(400).json({
      ok: false,
      message: "Wallet credentials missing. Set WALLET_PUBLIC_KEY and PRIVATE_KEY in Replit Secrets.",
    });
  }

  await new Promise<void>((resolve) => {
    exec("python3 -m pip install -q -r requirements.txt", { cwd: BOT_DIR }, (err) => {
      if (err) console.log("[bot] pip install warning:", err.message);
      else console.log("[bot] Python packages verified");
      resolve();
    });
  });

  const child = spawn("python3", ["bot.py", "--live"], {
    cwd: BOT_DIR,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      WALLET_PUBLIC_KEY: walletKey,
      PRIVATE_KEY:       privateKey,
      SOLANA_RPC_URL:    process.env["SOLANA_RPC_URL"] ?? "https://api.mainnet-beta.solana.com",
    },
  });
  child.unref();

  try { fs.writeFileSync(BOT_PID_FILE, String(child.pid)); } catch {}

  await new Promise(r => setTimeout(r, 2000));
  const running = await isBotRunning();
  if (!running) {
    return res.status(500).json({ ok: false, message: "Bot process exited immediately. Check bot.log for details." });
  }
  res.json({ ok: true, message: "Bot started in LIVE mode", pid: child.pid });
});

export default router;
