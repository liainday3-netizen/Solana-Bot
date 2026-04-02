import { Router } from "express";
import fs from "fs";
import path from "path";
import { exec, spawn } from "child_process";

const router = Router();

const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");
const BOT_STATE_FILE = path.join(WORKSPACE_ROOT, "solana-bot/bot_state.json");
const TRADES_FILE = path.join(WORKSPACE_ROOT, "solana-bot/trades.json");
const BOT_PID_FILE = path.join(WORKSPACE_ROOT, "solana-bot/.bot.pid");
const BOT_DIR = path.join(WORKSPACE_ROOT, "solana-bot");

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
    exec("pgrep -f 'python3 bot.py'", (err, stdout) => {
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
      mode: "paper",
      cycle: 0,
      timestamp: new Date().toISOString(),
      prices: {},
      wallet: { usdc: 0, holdings: {}, total_value_usdc: 0 },
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

  const buyCount = tradeList.filter((t: unknown) => (t as Record<string, unknown>)["action"] === "BUY").length;
  const sellCount = tradeList.filter((t: unknown) => (t as Record<string, unknown>)["action"] === "SELL").length;
  const lastTrade = tradeList[tradeList.length - 1] as Record<string, unknown> | undefined;

  res.json({
    total_trades: tradeList.length,
    runtime_seconds: state?.["runtime_seconds"] ?? 0,
    cycles: state?.["cycle"] ?? 0,
    starting_value: state?.["starting_value"] ?? 20,
    current_value: (state?.["wallet"] as Record<string, unknown> | undefined)?.["total_value_usdc"] ?? 0,
    pnl_usd: state?.["pnl_usd"] ?? 0,
    pnl_pct: state?.["pnl_pct"] ?? 0,
    mode: state?.["mode"] ?? "paper",
    buy_count: buyCount,
    sell_count: sellCount,
    last_trade_at: lastTrade?.["timestamp"] ?? null,
  });
});

router.post("/bot/stop", (_req, res) => {
  exec("pgrep -f 'bot.py'", (pgrepErr, stdout) => {
    const pids = stdout.trim().split("\n").filter(Boolean);
    if (pgrepErr || pids.length === 0) {
      return res.json({ ok: true, message: "Bot was not running" });
    }
    exec(`kill -TERM ${pids.join(" ")}`, () => {
      try { fs.unlinkSync(BOT_PID_FILE); } catch {}
      res.json({ ok: true, message: "Bot stopped" });
    });
  });
});

router.post("/bot/start", (req, res) => {
  const mode = req.body?.mode === "paper" ? "--paper" : "--live";

  exec("pgrep -f 'bot.py'", (pgrepErr, stdout) => {
    const pids = stdout.trim().split("\n").filter(Boolean);
    if (!pgrepErr && pids.length > 0) {
      return res.status(409).json({ ok: false, message: "Bot is already running" });
    }

    const child = spawn("python3", ["bot.py", mode], {
      cwd: BOT_DIR,
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    try {
      fs.writeFileSync(BOT_PID_FILE, String(child.pid));
    } catch {}

    res.json({ ok: true, message: `Bot started in ${mode === "--live" ? "live" : "paper"} mode`, pid: child.pid });
  });
});

export default router;
