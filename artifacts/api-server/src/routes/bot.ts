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
const BOT_DIR        = path.join(WORKSPACE_ROOT, "solana-bot");

console.log(`[bot] WORKSPACE_ROOT = ${WORKSPACE_ROOT}`);
console.log(`[bot] BOT_DIR        = ${BOT_DIR}`);

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

router.get("/bot/status", async (_req, res) => {
  const state = readJson(BOT_STATE_FILE) as Record<string, unknown> | null;
  const running = await isBotRunning();
  if (!state) {
    return res.json({
      running,
      mode: "live",
      cycle: 0,
      timestamp: new Date().toISOString(),
      prices: {},
      wallet: { usdc: 0, sol: 0, holdings: {}, total_value_usdc: 0 },
      starting_value: 20,
      pnl_usd: 0,
      pnl_pct: 0,
      total_trades: 0,
      trends: {},
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
    total_trades:   tradeList.length,
    runtime_seconds: state?.["runtime_seconds"] ?? 0,
    cycles:         state?.["cycle"] ?? 0,
    starting_value: state?.["starting_value"] ?? 20,
    current_value:  (state?.["wallet"] as Record<string, unknown> | undefined)?.["total_value_usdc"] ?? 0,
    pnl_usd:        state?.["pnl_usd"] ?? 0,
    pnl_pct:        state?.["pnl_pct"] ?? 0,
    mode:           state?.["mode"] ?? "live",
    buy_count:      buyCount,
    sell_count:     sellCount,
    last_trade_at:  lastTrade?.["timestamp"] ?? null,
  });
});

router.post("/bot/stop", async (_req, res) => {
  await killAllBotProcesses();
  await new Promise(r => setTimeout(r, 1500));
  const stillRunning = await isBotRunning();
  res.json({ ok: !stillRunning, message: stillRunning ? "Bot may still be running" : "Bot stopped" });
});

router.post("/bot/start", async (_req, res) => {
  const alreadyRunning = await isBotRunning();
  if (alreadyRunning) {
    return res.status(409).json({ ok: false, message: "Bot is already running" });
  }

  const walletKey = process.env["WALLET_PUBLIC_KEY"];
  const privateKey = process.env["PRIVATE_KEY"];

  if (!walletKey || !privateKey) {
    return res.status(400).json({
      ok: false,
      message: "Wallet credentials missing. Set WALLET_PUBLIC_KEY and PRIVATE_KEY in Replit Secrets.",
    });
  }

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
    return res.status(500).json({
      ok: false,
      message: "Bot process exited immediately. Check that Python dependencies are installed.",
    });
  }

  res.json({ ok: true, message: "Bot started in LIVE mode", pid: child.pid });
});

export default router;
