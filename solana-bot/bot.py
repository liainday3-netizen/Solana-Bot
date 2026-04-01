#!/usr/bin/env python3
"""
================================================================================
  SOLANA JUPITER TRADING BOT
================================================================================

  !!!!!!!!!!!!!!!!!!!!!!!!! CRITICAL RISK WARNING !!!!!!!!!!!!!!!!!!!!!!!!!!!!

  THIS SOFTWARE IS FOR EDUCATIONAL PURPOSES ONLY.

  TRADING ON SOLANA DEXES (DECENTRALIZED EXCHANGES) CARRIES EXTREME RISKS:

  1. YOU CAN LOSE 100% OF YOUR MONEY — crypto is highly volatile.
  2. SMART CONTRACT BUGS can drain wallets instantly with no recourse.
  3. THERE IS NO UNDO — blockchain transactions are irreversible.
  4. NO CUSTOMER SUPPORT — no bank, no FDIC, no safety net.
  5. BOT BUGS — automated bots can make repeated mistakes very fast.
  6. SLIPPAGE & FEES — you often get less than the quoted price.
  7. NETWORK FAILURES — RPC nodes go down; your bot may miss trades.
  8. YOUR PRIVATE KEY IS EVERYTHING — anyone who sees it owns your wallet.

  ⚠️  NEVER SHARE YOUR PRIVATE KEY WITH ANYONE — NOT EVEN "SUPPORT" ⚠️
  ⚠️  DO NOT COMMIT YOUR .env FILE TO GIT OR SHARE IT ONLINE            ⚠️
  ⚠️  DO NOT RUN THIS ON A WALLET WITH FUNDS YOU CANNOT AFFORD TO LOSE  ⚠️

================================================================================

USAGE:
  python3 bot.py              → interactive mode-select prompt at startup
  python3 bot.py --paper      → force paper mode (safe, no real money)
  python3 bot.py --live       → live mode, 5-second abort window, then trades start
"""

import os
import sys
import json
import time
import argparse
import logging
import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────────────────────────
# CLI arguments
# ─────────────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Solana Jupiter Trading Bot")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--paper", action="store_true",
                       help="Paper mode — virtual money, completely safe")
    group.add_argument("--live", action="store_true",
                       help="Live mode — REAL money on-chain")
    return parser.parse_args()


# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

load_dotenv()

MAX_RISK_PER_TRADE_PCT   = 0.50    # Never risk more than 50% of balance per trade
CIRCUIT_BREAKER_USD      = 5.00    # Stop entirely if balance drops below this
MIN_PROFIT_THRESHOLD_PCT = 0.005   # Skip signals smaller than 0.5%
SLIPPAGE_BPS             = 50      # 0.5% slippage tolerance
LOOP_INTERVAL_SECONDS    = 10      # Poll every 10 seconds
TRADE_AMOUNT_USD         = 5.00    # Fixed USDC per trade (capped at 50% of balance)
STARTING_PAPER_BALANCE   = 20.00   # Virtual USD for paper mode

SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")

TOKENS = {
    "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "SOL":  "So11111111111111111111111111111111111111112",
    "BONK": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "JUP":  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    "WIF":  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
}
TOKEN_DECIMALS = {"USDC": 6, "SOL": 9, "BONK": 5, "JUP": 6, "WIF": 6}

JUPITER_QUOTE_URL = "https://quote-api.jup.ag/v6/quote"
JUPITER_SWAP_URL  = "https://quote-api.jup.ag/v6/swap"

TRADE_LOG_FILE = Path("trades.json")
FOCUS_TOKENS   = ["SOL", "JUP", "BONK"]

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("bot.log"),
    ],
)
log = logging.getLogger("solana-bot")


# ─────────────────────────────────────────────────────────────────────────────
# Mode selection
# ─────────────────────────────────────────────────────────────────────────────

def select_mode(args: argparse.Namespace) -> bool:
    """
    Returns True = paper mode, False = live mode.

    Priority:
      --paper / --live CLI flag  →  honoured immediately, no prompt
      no flag                    →  interactive 1/2 prompt at startup

    --live shows a warning + 5-second abort window but does NOT require
    typing a phrase; passing the flag is itself the commitment.
    """
    if args.paper:
        print("\n  [--paper] Paper mode — no real money at risk.\n")
        return True

    if args.live:
        _print_live_warning()
        return _live_countdown_and_check()

    # Interactive prompt
    env_default_paper = os.getenv("PAPER_MODE", "true").lower() in ("true", "1", "yes")
    _print_mode_menu(env_default_paper)

    try:
        choice = input(
            f"  Enter 1 or 2  [default: {'1' if env_default_paper else '2'}]: "
        ).strip()
    except (EOFError, KeyboardInterrupt):
        print("\n  No input — defaulting to paper mode.\n")
        return True

    if choice == "2":
        print()
        _print_live_warning()
        return _live_countdown_and_check()

    if choice not in ("1", "2", ""):
        print("  Invalid — defaulting to paper mode.")
    return True


def _print_mode_menu(default_paper: bool):
    default_label = "paper" if default_paper else "live"
    print()
    print("=" * 72)
    print("  SOLANA JUPITER TRADING BOT")
    print("=" * 72)
    print()
    print("  Select trading mode:")
    print()
    print("  [1] PAPER MODE  — safe, virtual $20 USDC  (recommended)")
    print("  [2] LIVE MODE   — REAL money, irreversible on-chain transactions")
    print()
    print(f"  (Your .env default: {default_label})")
    print()


def _print_live_warning():
    print()
    print("  " + "!" * 68)
    print("  !!  LIVE MODE — REAL MONEY WILL BE USED ON-CHAIN               !!")
    print("  !!                                                              !!")
    print("  !!  • You can lose 100% of your funds instantly                !!")
    print("  !!  • All transactions are IRREVERSIBLE — there is no undo     !!")
    print("  !!  • Bot bugs can drain your wallet before you can react      !!")
    print("  !!  • Slippage and fees reduce every trade                     !!")
    print("  !!  • Network failures can cause missed or double trades       !!")
    print("  !!                                                              !!")
    print("  !!  Use a DEDICATED wallet with ONLY money you can lose        !!")
    print("  !!  NEVER use your main wallet or savings                      !!")
    print("  " + "!" * 68)
    print()


def _live_countdown_and_check() -> bool:
    """
    Verify required .env keys exist, then give a 5-second abort window.
    Returns False (= live mode) on success, True (= paper fallback) on failure.
    """
    missing = []
    if not os.getenv("WALLET_PUBLIC_KEY"):
        missing.append("WALLET_PUBLIC_KEY")
    if not os.getenv("PRIVATE_KEY"):
        missing.append("PRIVATE_KEY")

    if missing:
        print("  ERROR: The following keys are missing from your .env file:")
        for key in missing:
            print(f"    • {key}")
        print()
        print("  Cannot run live mode without wallet credentials.")
        print("  See .env.example for setup instructions.")
        print("  ⚠️  NEVER share your PRIVATE_KEY with anyone.")
        print()
        print("  Falling back to paper mode.\n")
        return True   # paper

    print("  Wallet keys found in .env.")
    print()
    try:
        for i in range(5, 0, -1):
            print(f"  Starting LIVE trading in {i}s... (Ctrl+C to abort)", end="\r", flush=True)
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n  Aborted — switching to paper mode.\n")
        return True  # paper

    print()
    print("  ⚠️  LIVE MODE ACTIVE — real money is now at risk.\n")
    return False   # live


# ─────────────────────────────────────────────────────────────────────────────
# Trade log
# ─────────────────────────────────────────────────────────────────────────────

def load_trade_log() -> list:
    if TRADE_LOG_FILE.exists():
        try:
            return json.loads(TRADE_LOG_FILE.read_text())
        except json.JSONDecodeError:
            return []
    return []


def save_trade(entry: dict):
    trades = load_trade_log()
    trades.append(entry)
    TRADE_LOG_FILE.write_text(json.dumps(trades, indent=2))


# ─────────────────────────────────────────────────────────────────────────────
# Solana RPC helpers (no extra packages — raw JSON-RPC)
# ─────────────────────────────────────────────────────────────────────────────

def _rpc(method: str, params: list) -> dict | None:
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    try:
        resp = requests.post(SOLANA_RPC_URL, json=payload, timeout=10)
        resp.raise_for_status()
        return resp.json().get("result")
    except requests.RequestException as exc:
        log.warning("RPC error (%s): %s", method, exc)
        return None


def get_live_usdc_balance(public_key: str) -> float:
    """
    Returns the on-chain USDC balance in human-readable USD for the wallet.
    """
    result = _rpc("getTokenAccountsByOwner", [
        public_key,
        {"mint": TOKENS["USDC"]},
        {"encoding": "jsonParsed"},
    ])
    if not result:
        return 0.0
    accounts = result.get("value", [])
    total = 0.0
    for acct in accounts:
        info = acct.get("account", {}).get("data", {}).get("parsed", {}).get("info", {})
        ui_amount = info.get("tokenAmount", {}).get("uiAmount", 0.0)
        total += ui_amount or 0.0
    return total


def get_live_token_balance(public_key: str, token_symbol: str) -> float:
    """
    Returns the on-chain balance of a SPL token in human-readable units.
    """
    if token_symbol == "SOL":
        result = _rpc("getBalance", [public_key])
        if result is None:
            return 0.0
        lamports = result.get("value", 0)
        return lamports / 10 ** TOKEN_DECIMALS["SOL"]

    result = _rpc("getTokenAccountsByOwner", [
        public_key,
        {"mint": TOKENS[token_symbol]},
        {"encoding": "jsonParsed"},
    ])
    if not result:
        return 0.0
    accounts = result.get("value", [])
    total = 0.0
    for acct in accounts:
        info = acct.get("account", {}).get("data", {}).get("parsed", {}).get("info", {})
        ui_amount = info.get("tokenAmount", {}).get("uiAmount", 0.0)
        total += ui_amount or 0.0
    return total


# ─────────────────────────────────────────────────────────────────────────────
# Jupiter API helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_quote(
    input_mint: str,
    output_mint: str,
    amount_lamports: int,
    slippage_bps: int = SLIPPAGE_BPS,
) -> dict | None:
    params = {
        "inputMint":   input_mint,
        "outputMint":  output_mint,
        "amount":      amount_lamports,
        "slippageBps": slippage_bps,
    }
    try:
        resp = requests.get(JUPITER_QUOTE_URL, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        log.warning("Jupiter quote error: %s", exc)
        return None


def usdc_to_raw(amount_usdc: float) -> int:
    return int(amount_usdc * 10 ** TOKEN_DECIMALS["USDC"])


def raw_to_human(raw_amount: int, token: str) -> float:
    return raw_amount / 10 ** TOKEN_DECIMALS[token]


def get_token_price_in_usdc(token_symbol: str) -> float | None:
    if token_symbol == "USDC":
        return 1.0
    quote = get_quote(
        input_mint=TOKENS["USDC"],
        output_mint=TOKENS[token_symbol],
        amount_lamports=usdc_to_raw(1.0),
    )
    if not quote:
        return None
    out_raw = int(quote.get("outAmount", 0))
    if out_raw == 0:
        return None
    per_usdc = raw_to_human(out_raw, token_symbol)
    return (1.0 / per_usdc) if per_usdc else None


# ─────────────────────────────────────────────────────────────────────────────
# Strategy
# ─────────────────────────────────────────────────────────────────────────────

class PriceHistory:
    def __init__(self, window: int = 6):
        self.window = window
        self.prices: dict[str, list[float]] = {}

    def update(self, token: str, price: float):
        bucket = self.prices.setdefault(token, [])
        bucket.append(price)
        if len(bucket) > self.window:
            bucket.pop(0)

    def trend(self, token: str) -> float | None:
        bucket = self.prices.get(token, [])
        if len(bucket) < 2 or bucket[0] == 0:
            return None
        return (bucket[-1] - bucket[0]) / bucket[0]


def decide_trade(
    token: str,
    trend_pct: float,
    current_price: float,
    holdings_token: float,
    balance_usdc: float,
) -> tuple[str, str, float]:
    if balance_usdc < CIRCUIT_BREAKER_USD:
        return "HOLD", "circuit-breaker: balance too low", 0.0
    if trend_pct > MIN_PROFIT_THRESHOLD_PCT and balance_usdc >= TRADE_AMOUNT_USD:
        amount = min(TRADE_AMOUNT_USD, balance_usdc * MAX_RISK_PER_TRADE_PCT)
        return "BUY", f"uptrend {trend_pct*100:.2f}%", amount
    if trend_pct < -MIN_PROFIT_THRESHOLD_PCT and holdings_token > 0:
        return "SELL", f"downtrend {trend_pct*100:.2f}%", holdings_token * current_price
    return "HOLD", f"no signal (trend {trend_pct*100:.2f}%)", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Paper wallet
# ─────────────────────────────────────────────────────────────────────────────

class PaperWallet:
    def __init__(self, starting_usdc: float = STARTING_PAPER_BALANCE):
        self.usdc = starting_usdc
        self.holdings: dict[str, float] = {}

    def buy(self, token: str, usdc_amount: float, price: float) -> float:
        usdc_amount = min(usdc_amount, self.usdc)
        tokens_bought = usdc_amount / price
        self.usdc -= usdc_amount
        self.holdings[token] = self.holdings.get(token, 0.0) + tokens_bought
        return tokens_bought

    def sell(self, token: str, token_amount: float, price: float) -> float:
        token_amount = min(token_amount, self.holdings.get(token, 0.0))
        usdc_received = token_amount * price
        self.usdc += usdc_received
        remaining = self.holdings.get(token, 0.0) - token_amount
        if remaining <= 0:
            self.holdings.pop(token, None)
        else:
            self.holdings[token] = remaining
        return usdc_received

    def total_value_usdc(self, prices: dict[str, float]) -> float:
        return self.usdc + sum(
            amt * prices.get(tok, 0) for tok, amt in self.holdings.items()
        )


# ─────────────────────────────────────────────────────────────────────────────
# Live transaction signing & sending
# ─────────────────────────────────────────────────────────────────────────────

def build_swap_transaction(quote: dict, user_public_key: str) -> dict | None:
    body = {
        "quoteResponse":             quote,
        "userPublicKey":             user_public_key,
        "wrapAndUnwrapSol":          True,
        "dynamicComputeUnitLimit":   True,
        "prioritizationFeeLamports": "auto",
    }
    try:
        resp = requests.post(JUPITER_SWAP_URL, json=body, timeout=15)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        log.error("[LIVE] Failed to build swap tx: %s", exc)
        return None


def sign_and_send(swap_response: dict, private_key_b58: str) -> str | None:
    """
    Decode the Jupiter serialised transaction, sign with the wallet keypair,
    broadcast to Solana mainnet, and poll for confirmation.
    """
    try:
        import base64
        from solders.keypair import Keypair
        from solders.transaction import VersionedTransaction
        from solana.rpc.api import Client
        from solana.rpc.types import TxOpts
        from solana.rpc.commitment import Confirmed

        raw_b64 = swap_response.get("swapTransaction", "")
        if not raw_b64:
            log.error("[LIVE] Jupiter response missing 'swapTransaction'")
            return None

        raw_bytes = base64.b64decode(raw_b64)
        tx        = VersionedTransaction.from_bytes(raw_bytes)
        keypair   = Keypair.from_base58_string(private_key_b58)
        signed_tx = VersionedTransaction(tx.message, [keypair])

        client = Client(SOLANA_RPC_URL)
        opts   = TxOpts(skip_preflight=False, preflight_commitment=Confirmed)
        result = client.send_raw_transaction(bytes(signed_tx), opts=opts)

        if result.value is None:
            log.error("[LIVE] RPC returned no signature")
            return None

        sig = str(result.value)
        log.info("[LIVE] Broadcast OK — sig: %s", sig)

        # Poll for confirmation (~30 s)
        for attempt in range(10):
            time.sleep(3)
            status = client.get_signature_statuses([result.value])
            if status.value and status.value[0]:
                conf = str(status.value[0].confirmation_status)
                log.info("[LIVE] Confirm attempt %d/10 — %s", attempt + 1, conf)
                if conf in ("confirmed", "finalized"):
                    log.info("[LIVE] ✅ Confirmed: %s", sig)
                    return sig

        log.warning("[LIVE] Not confirmed after 30s — sig: %s", sig)
        return sig

    except ImportError as exc:
        log.error("[LIVE] Missing package: %s — run: pip install solana solders", exc)
        return None
    except Exception as exc:
        log.error("[LIVE] Unexpected error: %s", exc)
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Banner
# ─────────────────────────────────────────────────────────────────────────────

def print_banner(paper_mode: bool, live_usdc: float | None = None):
    print("=" * 72)
    print("  SOLANA JUPITER TRADING BOT")
    print("=" * 72)
    print()
    if paper_mode:
        print(f"  ✅  PAPER MODE — virtual ${STARTING_PAPER_BALANCE:.2f} USDC, no real risk")
    else:
        bal_str = f"${live_usdc:.4f}" if live_usdc is not None else "(fetching...)"
        print(f"  ⚠️   LIVE MODE — wallet USDC balance: {bal_str}")
    print()
    print(f"  Max risk per trade : {MAX_RISK_PER_TRADE_PCT*100:.0f}% of balance")
    print(f"  Circuit breaker    : stop below ${CIRCUIT_BREAKER_USD:.2f}")
    print(f"  Min signal         : {MIN_PROFIT_THRESHOLD_PCT*100:.1f}% price move")
    print(f"  Trade size         : ${TRADE_AMOUNT_USD:.2f} USDC")
    print(f"  Poll interval      : {LOOP_INTERVAL_SECONDS}s")
    print(f"  Trade log          : {TRADE_LOG_FILE}")
    print()
    print("  Press Ctrl+C to stop.")
    print("=" * 72)
    print()


# ─────────────────────────────────────────────────────────────────────────────
# Main loop
# ─────────────────────────────────────────────────────────────────────────────

def run_bot(paper_mode: bool):
    public_key = None if paper_mode else os.getenv("WALLET_PUBLIC_KEY", "")
    private_key = None if paper_mode else os.getenv("PRIVATE_KEY", "")

    if not paper_mode and not public_key:
        log.error("WALLET_PUBLIC_KEY missing — falling back to paper mode.")
        paper_mode = True

    # Fetch live balance to show in banner
    live_usdc_balance: float | None = None
    if not paper_mode and public_key:
        live_usdc_balance = get_live_usdc_balance(public_key)

    wallet  = PaperWallet() if paper_mode else None
    history = PriceHistory(window=6)
    label   = "PAPER" if paper_mode else "LIVE"

    print_banner(paper_mode, live_usdc_balance)

    cycle = 0
    while True:
        cycle += 1
        log.info("─── Cycle %d [%s] ─────────────────────────────────────────────", cycle, label)

        # ── 1. Prices ────────────────────────────────────────────────────────
        prices: dict[str, float] = {}
        for token in FOCUS_TOKENS:
            price = get_token_price_in_usdc(token)
            if price is not None:
                prices[token] = price
                history.update(token, price)
                log.info("  %s  $%.6f", token, price)
            else:
                log.warning("  %s  — price unavailable", token)

        # ── 2. Wallet state ──────────────────────────────────────────────────
        if paper_mode and wallet:
            total = wallet.total_value_usdc(prices)
            log.info(
                "  Wallet — USDC: $%.4f | Holdings: %s | Total: $%.4f",
                wallet.usdc,
                {t: f"{a:.6f}" for t, a in wallet.holdings.items()},
                total,
            )
            if wallet.usdc < CIRCUIT_BREAKER_USD and not wallet.holdings:
                log.error(
                    "  🚨 CIRCUIT BREAKER — balance $%.4f fell below $%.2f. Stopping.",
                    wallet.usdc, CIRCUIT_BREAKER_USD,
                )
                break

        elif not paper_mode and public_key:
            # Fetch real wallet balances from chain
            live_usdc_balance = get_live_usdc_balance(public_key)
            log.info("  Live wallet — USDC: $%.4f", live_usdc_balance)

            if live_usdc_balance < CIRCUIT_BREAKER_USD:
                # Check if there are any token holdings before stopping
                any_holdings = any(
                    get_live_token_balance(public_key, t) > 0 for t in FOCUS_TOKENS
                )
                if not any_holdings:
                    log.error(
                        "  🚨 CIRCUIT BREAKER — live balance $%.4f below $%.2f. Stopping.",
                        live_usdc_balance, CIRCUIT_BREAKER_USD,
                    )
                    break

        # ── 3. Strategy & execution ──────────────────────────────────────────
        for token in FOCUS_TOKENS:
            if token not in prices:
                continue

            trend = history.trend(token)
            if trend is None:
                n = len(history.prices.get(token, []))
                log.info("  %s  warming up (%d/%d)...", token, n, history.window)
                continue

            current_price = prices[token]

            # Get holdings and balance — real chain data in live mode
            if paper_mode and wallet:
                holdings     = wallet.holdings.get(token, 0.0)
                balance_usdc = wallet.usdc
            elif not paper_mode and public_key:
                holdings     = get_live_token_balance(public_key, token)
                balance_usdc = live_usdc_balance or 0.0
            else:
                continue

            action, reason, trade_usdc = decide_trade(
                token, trend, current_price, holdings, balance_usdc,
            )
            log.info("  %s  %s — %s", token, action, reason)

            if action == "HOLD":
                continue

            trade_entry: dict = {
                "timestamp":  datetime.datetime.utcnow().isoformat() + "Z",
                "cycle":      cycle,
                "mode":       label.lower(),
                "token":      token,
                "action":     action,
                "price_usdc": current_price,
                "trend_pct":  round(trend * 100, 4),
                "reason":     reason,
            }

            # ── Paper execution ──────────────────────────────────────────────
            if paper_mode and wallet:
                if action == "BUY":
                    bought = wallet.buy(token, trade_usdc, current_price)
                    trade_entry.update(usdc_spent=round(trade_usdc, 6),
                                       tokens_bought=round(bought, 6))
                    log.info("  [PAPER] BUY  %.6f %s  cost $%.4f  @ $%.6f",
                             bought, token, trade_usdc, current_price)
                else:
                    received = wallet.sell(token, holdings, current_price)
                    trade_entry.update(tokens_sold=round(holdings, 6),
                                       usdc_received=round(received, 6))
                    log.info("  [PAPER] SELL %.6f %s  recv $%.4f  @ $%.6f",
                             holdings, token, received, current_price)
                save_trade(trade_entry)

            # ── Live execution ───────────────────────────────────────────────
            else:
                if action == "BUY":
                    raw_in = usdc_to_raw(trade_usdc)
                    quote  = get_quote(TOKENS["USDC"], TOKENS[token], raw_in)
                else:
                    raw_in = int(holdings * 10 ** TOKEN_DECIMALS[token])
                    quote  = get_quote(TOKENS[token], TOKENS["USDC"], raw_in)

                if not quote:
                    log.error("  [LIVE] No quote for %s %s — skipping", action, token)
                    continue

                log.info(
                    "  [LIVE] Quote: %s %s | in=%d out=%s",
                    action, token, raw_in, quote.get("outAmount"),
                )

                swap_resp = build_swap_transaction(quote, public_key)
                if not swap_resp:
                    log.error("  [LIVE] Failed to build swap transaction")
                    save_trade({**trade_entry, "error": "swap_build_failed"})
                    continue

                sig = sign_and_send(swap_resp, private_key)
                trade_entry["tx_signature"] = sig
                if sig:
                    log.info("  [LIVE] ✅ %s %s executed — sig: %s", action, token, sig)
                    log.info("  [LIVE]    View: https://solscan.io/tx/%s", sig)
                else:
                    log.error("  [LIVE] ❌ %s %s FAILED — no signature returned", action, token)

                save_trade(trade_entry)

        log.info("  Sleeping %ds...\n", LOOP_INTERVAL_SECONDS)
        time.sleep(LOOP_INTERVAL_SECONDS)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = parse_args()
    try:
        paper_mode = select_mode(args)
        run_bot(paper_mode)
    except KeyboardInterrupt:
        log.info("Bot stopped by user (Ctrl+C).")
        log.info("Trades logged: %d  (see %s)", len(load_trade_log()), TRADE_LOG_FILE)
        sys.exit(0)
