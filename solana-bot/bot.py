#!/usr/bin/env python3
"""
================================================================================
  SOLANA JUPITER TRADING BOT — EDUCATIONAL / PAPER MODE
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

  START WITH PAPER MODE (DEFAULT). Only enable live trading after you fully
  understand all of these risks. Even then, only use money you can afford
  to lose entirely.

  ⚠️  NEVER SHARE YOUR PRIVATE KEY WITH ANYONE — NOT EVEN "SUPPORT" ⚠️
  ⚠️  DO NOT COMMIT YOUR .env FILE TO GIT OR SHARE IT ONLINE            ⚠️
  ⚠️  DO NOT RUN THIS ON A WALLET WITH FUNDS YOU CANNOT AFFORD TO LOSE  ⚠️

================================================================================

USAGE:
  python3 bot.py              → interactive mode-select prompt at startup
  python3 bot.py --paper      → force paper mode (safe, no real money)
  python3 bot.py --live       → force live mode (real money — use with caution)
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
    parser = argparse.ArgumentParser(
        description="Solana Jupiter Trading Bot",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--paper",
        action="store_true",
        help="Run in paper mode (virtual money, safe default)",
    )
    group.add_argument(
        "--live",
        action="store_true",
        help="Run in live mode (REAL money — requires .env keys and confirmation)",
    )
    return parser.parse_args()


# ─────────────────────────────────────────────────────────────────────────────
# Configuration  (loaded after arg-parse so PAPER_MODE can be overridden)
# ─────────────────────────────────────────────────────────────────────────────

load_dotenv()

MAX_RISK_PER_TRADE_PCT   = 0.50    # Never risk more than 50% of balance on one trade
CIRCUIT_BREAKER_USD      = 5.00    # Stop trading if balance drops below $5
MIN_PROFIT_THRESHOLD_PCT = 0.005   # Skip opportunities smaller than 0.5%
SLIPPAGE_BPS             = 50      # 0.5% slippage tolerance (basis points)
LOOP_INTERVAL_SECONDS    = 10      # Check every 10 seconds
TRADE_AMOUNT_USD         = 5.00    # USDC to use per trade (capped at 50% of balance)

STARTING_PAPER_BALANCE_USDC = 20.00

LIVE_CONFIRM_PHRASE = "I UNDERSTAND THE RISKS"   # must be typed exactly to enable live mode

# ── Token mint addresses on Solana mainnet ────────────────────────────────────
TOKENS = {
    "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "SOL":  "So11111111111111111111111111111111111111112",
    "BONK": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "JUP":  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    "WIF":  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
}

TOKEN_DECIMALS = {
    "USDC": 6,
    "SOL":  9,
    "BONK": 5,
    "JUP":  6,
    "WIF":  6,
}

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
# Mode selection — interactive prompt or CLI flag
# ─────────────────────────────────────────────────────────────────────────────

def select_mode(args: argparse.Namespace) -> bool:
    """
    Determine whether to run in paper mode (True) or live mode (False).

    Priority order:
      1. CLI flag  --paper / --live  (non-interactive, overrides everything)
      2. PAPER_MODE env var in .env
      3. Interactive prompt at startup

    Live mode always requires typing a confirmation phrase — even when forced
    via --live — to prevent accidents.

    Returns True for paper mode, False for live mode.
    """
    # ── 1. CLI flags ──────────────────────────────────────────────────────────
    if args.paper:
        print("\n  [--paper flag] Paper mode selected.\n")
        return True

    if args.live:
        print()
        _live_warning()
        confirmed = _require_live_confirmation()
        return not confirmed   # False = live, True = back to paper

    # ── 2. .env default ───────────────────────────────────────────────────────
    env_paper = os.getenv("PAPER_MODE", "true").lower() in ("true", "1", "yes")

    # ── 3. Interactive prompt ─────────────────────────────────────────────────
    print()
    print("=" * 72)
    print("  SOLANA JUPITER TRADING BOT")
    print("=" * 72)
    print()
    print("  Select trading mode:")
    print()
    print("  [1] PAPER MODE  — safe, virtual $20 USDC  (default, recommended)")
    print("  [2] LIVE MODE   — REAL money, irreversible on-chain transactions")
    print()

    default_label = "1 (paper)" if env_paper else "2 (live)"
    try:
        choice = input(f"  Enter 1 or 2  [default: {default_label}]: ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\n  No input — defaulting to paper mode.")
        return True

    if choice == "2":
        print()
        _live_warning()
        confirmed = _require_live_confirmation()
        return not confirmed  # False = live, True = back to paper (if cancelled)

    # Everything else (blank, "1", or invalid) → paper
    if choice not in ("1", "2", ""):
        print("  Invalid input — defaulting to paper mode.")
    return True


def _live_warning():
    """Print the live-mode risk block."""
    print("  " + "!" * 68)
    print("  !!  LIVE MODE — REAL MONEY WILL BE USED                        !!")
    print("  !!                                                              !!")
    print("  !!  Risks you are accepting:                                    !!")
    print("  !!  • You can lose 100% of your funds                          !!")
    print("  !!  • Transactions are IRREVERSIBLE — there is no undo         !!")
    print("  !!  • This bot is experimental — bugs can drain your wallet    !!")
    print("  !!  • Slippage and fees reduce every trade's value             !!")
    print("  !!  • Network outages can cause missed or repeated trades      !!")
    print("  !!                                                              !!")
    print("  !!  ONLY use a DEDICATED wallet with funds you can lose        !!")
    print("  !!  NEVER use your main wallet or savings                      !!")
    print("  " + "!" * 68)
    print()


def _require_live_confirmation() -> bool:
    """
    Prompt the user to type the exact confirmation phrase.
    Returns True if confirmed, False if cancelled.
    """
    print(f'  To proceed, type exactly:  {LIVE_CONFIRM_PHRASE}')
    print("  (or press Enter to cancel and go back to paper mode)")
    print()
    try:
        answer = input("  > ").strip()
    except (EOFError, KeyboardInterrupt):
        answer = ""

    if answer == LIVE_CONFIRM_PHRASE:
        print()
        print("  ⚠️  Live mode confirmed. Bot will use REAL funds.")
        # Verify required env vars are set
        if not os.getenv("WALLET_PUBLIC_KEY"):
            print()
            print("  ERROR: WALLET_PUBLIC_KEY is not set in your .env file.")
            print("  Cannot run live mode without a wallet address.")
            print("  Falling back to paper mode.")
            return False
        if not os.getenv("PRIVATE_KEY"):
            print()
            print("  ERROR: PRIVATE_KEY is not set in your .env file.")
            print("  Cannot sign transactions without a private key.")
            print("  ⚠️  Never share your private key with anyone.")
            print("  Falling back to paper mode.")
            return False
        print()
        for i in range(5, 0, -1):
            print(f"  Starting LIVE trading in {i}s... (Ctrl+C to abort)", end="\r")
            time.sleep(1)
        print()
        return True
    else:
        print()
        print("  Confirmation not matched — switching to paper mode (safe).")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Trade log helpers
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
    raw_usdc = usdc_to_raw(1.0)
    quote = get_quote(
        input_mint=TOKENS["USDC"],
        output_mint=TOKENS[token_symbol],
        amount_lamports=raw_usdc,
    )
    if not quote:
        return None
    out_amount_raw = int(quote.get("outAmount", 0))
    if out_amount_raw == 0:
        return None
    tokens_per_usdc = raw_to_human(out_amount_raw, token_symbol)
    if tokens_per_usdc == 0:
        return None
    return 1.0 / tokens_per_usdc


# ─────────────────────────────────────────────────────────────────────────────
# Simple momentum strategy
# ─────────────────────────────────────────────────────────────────────────────

class PriceHistory:
    def __init__(self, window: int = 6):
        self.window = window
        self.prices: dict[str, list[float]] = {}

    def update(self, token: str, price: float):
        if token not in self.prices:
            self.prices[token] = []
        self.prices[token].append(price)
        if len(self.prices[token]) > self.window:
            self.prices[token].pop(0)

    def trend(self, token: str) -> float | None:
        if token not in self.prices or len(self.prices[token]) < 2:
            return None
        oldest = self.prices[token][0]
        newest = self.prices[token][-1]
        if oldest == 0:
            return None
        return (newest - oldest) / oldest


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
        trade_amount = min(TRADE_AMOUNT_USD, balance_usdc * MAX_RISK_PER_TRADE_PCT)
        return "BUY", f"uptrend {trend_pct*100:.2f}%", trade_amount
    if trend_pct < -MIN_PROFIT_THRESHOLD_PCT and holdings_token > 0:
        return "SELL", f"downtrend {trend_pct*100:.2f}%", holdings_token * current_price
    return "HOLD", f"no clear signal (trend {trend_pct*100:.2f}%)", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Paper trading engine
# ─────────────────────────────────────────────────────────────────────────────

class PaperWallet:
    def __init__(self, starting_usdc: float = STARTING_PAPER_BALANCE_USDC):
        self.usdc = starting_usdc
        self.holdings: dict[str, float] = {}

    def buy(self, token: str, usdc_amount: float, price: float) -> float:
        if usdc_amount > self.usdc:
            usdc_amount = self.usdc
        tokens_bought = usdc_amount / price
        self.usdc -= usdc_amount
        self.holdings[token] = self.holdings.get(token, 0.0) + tokens_bought
        return tokens_bought

    def sell(self, token: str, token_amount: float, price: float) -> float:
        if token not in self.holdings or self.holdings[token] < token_amount:
            token_amount = self.holdings.get(token, 0.0)
        usdc_received = token_amount * price
        self.usdc += usdc_received
        self.holdings[token] = self.holdings.get(token, 0.0) - token_amount
        if self.holdings[token] <= 0:
            del self.holdings[token]
        return usdc_received

    def total_value_usdc(self, prices: dict[str, float]) -> float:
        total = self.usdc
        for token, amount in self.holdings.items():
            total += amount * prices.get(token, 0)
        return total


# ─────────────────────────────────────────────────────────────────────────────
# Live trading (quote + sign + send)
# ─────────────────────────────────────────────────────────────────────────────

def build_live_swap_transaction(quote: dict, user_public_key: str) -> dict | None:
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
        log.error("Failed to build swap tx: %s", exc)
        return None


def sign_and_send_transaction(swap_response: dict, private_key_b58: str) -> str | None:
    """
    Signs and submits a Jupiter swap transaction to the Solana network.

    Steps:
      1. Decode swap_response["swapTransaction"] from base64
      2. Deserialize to VersionedTransaction (solders)
      3. Sign with the private key
      4. Send via Solana RPC (sendTransaction)
      5. Confirm with getSignatureStatuses

    This requires PRIVATE_KEY in .env.  Never log the key itself.
    """
    try:
        import base64
        from solders.keypair import Keypair
        from solders.transaction import VersionedTransaction
        from solana.rpc.api import Client

        rpc_url = os.getenv(
            "SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"
        )
        client = Client(rpc_url)

        raw_tx_b64 = swap_response.get("swapTransaction", "")
        if not raw_tx_b64:
            log.error("[LIVE] swap_response missing 'swapTransaction' field")
            return None

        raw_tx_bytes = base64.b64decode(raw_tx_b64)
        tx = VersionedTransaction.from_bytes(raw_tx_bytes)

        keypair = Keypair.from_base58_string(private_key_b58)
        signed_tx = VersionedTransaction(tx.message, [keypair])

        result = client.send_raw_transaction(bytes(signed_tx))
        if result.value is None:
            log.error("[LIVE] sendRawTransaction returned no signature")
            return None

        sig = str(result.value)
        log.info("[LIVE] Transaction submitted — signature: %s", sig)

        # Poll for confirmation (up to ~30 s)
        for attempt in range(10):
            time.sleep(3)
            status = client.get_signature_statuses([result.value])
            if status.value and status.value[0]:
                confirmation = status.value[0].confirmation_status
                log.info(
                    "[LIVE] Confirmation attempt %d/%d — status: %s",
                    attempt + 1, 10, confirmation,
                )
                if str(confirmation) in ("confirmed", "finalized"):
                    log.info("[LIVE] ✅ Transaction confirmed: %s", sig)
                    return sig

        log.warning("[LIVE] Transaction not confirmed after 30s — sig: %s", sig)
        return sig

    except ImportError as exc:
        log.error(
            "[LIVE] Missing package for live trading (%s). "
            "Run: pip install solana solders",
            exc,
        )
        return None
    except Exception as exc:
        log.error("[LIVE] Unexpected error sending transaction: %s", exc)
        return None


def load_wallet_public_key() -> str | None:
    pk = os.getenv("WALLET_PUBLIC_KEY", "")
    if pk:
        return pk
    log.warning(
        "WALLET_PUBLIC_KEY not set in .env — live trading disabled. "
        "Switching to paper mode."
    )
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Banner
# ─────────────────────────────────────────────────────────────────────────────

def print_run_banner(paper_mode: bool):
    print("=" * 72)
    print("  SOLANA JUPITER TRADING BOT — EDUCATIONAL VERSION")
    print("=" * 72)
    print()
    if paper_mode:
        print("  ✅  PAPER MODE — No real money is at risk")
        print(f"  Virtual starting balance: ${STARTING_PAPER_BALANCE_USDC:.2f} USDC")
    else:
        print("  ⚠️  LIVE MODE — REAL MONEY IS BEING TRADED")
    print()
    print("  Safety settings:")
    print(f"  - Max risk per trade : {MAX_RISK_PER_TRADE_PCT*100:.0f}% of balance")
    print(f"  - Circuit breaker    : stop if balance < ${CIRCUIT_BREAKER_USD:.2f}")
    print(f"  - Min threshold      : {MIN_PROFIT_THRESHOLD_PCT*100:.1f}% trend required")
    print(f"  - Trade size         : ${TRADE_AMOUNT_USD:.2f} USDC per trade")
    print(f"  - Poll interval      : every {LOOP_INTERVAL_SECONDS}s")
    print("  - Trade log          : trades.json")
    print()
    print("  Press Ctrl+C to stop.")
    print("=" * 72)
    print()


# ─────────────────────────────────────────────────────────────────────────────
# Main bot loop
# ─────────────────────────────────────────────────────────────────────────────

def run_bot(paper_mode: bool):
    print_run_banner(paper_mode)

    wallet     = PaperWallet() if paper_mode else None
    history    = PriceHistory(window=6)
    public_key = None if paper_mode else load_wallet_public_key()

    # If live-mode wallet key lookup failed, fall back to paper
    if not paper_mode and public_key is None:
        log.warning("No wallet public key — falling back to paper mode.")
        paper_mode = True
        wallet = PaperWallet()

    mode_label = "PAPER" if paper_mode else "LIVE"

    cycle = 0
    while True:
        cycle += 1
        log.info("─── Cycle %d [%s] ──────────────────────────────────────────", cycle, mode_label)

        # 1. Fetch prices
        prices: dict[str, float] = {}
        for token in FOCUS_TOKENS:
            price = get_token_price_in_usdc(token)
            if price is not None:
                prices[token] = price
                history.update(token, price)
                log.info("  %s price: $%.6f USDC", token, price)
            else:
                log.warning("  Could not fetch price for %s", token)

        # 2. Report wallet state
        if paper_mode and wallet:
            total = wallet.total_value_usdc(prices)
            log.info(
                "  Paper wallet — USDC: $%.4f | Holdings: %s | Total: $%.4f",
                wallet.usdc,
                {t: f"{a:.4f}" for t, a in wallet.holdings.items()},
                total,
            )
            if wallet.usdc < CIRCUIT_BREAKER_USD and not wallet.holdings:
                log.error(
                    "  🚨 CIRCUIT BREAKER — balance ($%.4f) fell below $%.2f. Stopping.",
                    wallet.usdc, CIRCUIT_BREAKER_USD,
                )
                break

        # 3. Decide & execute
        for token in FOCUS_TOKENS:
            if token not in prices:
                continue

            trend = history.trend(token)
            if trend is None:
                log.info("  %s: building price history (%d/%d cycles)...",
                         token, len(history.prices.get(token, [])), history.window)
                continue

            current_price = prices[token]
            holdings      = wallet.holdings.get(token, 0.0) if (paper_mode and wallet) else 0.0
            balance_usdc  = wallet.usdc if (paper_mode and wallet) else 0.0

            action, reason, trade_usdc = decide_trade(
                token, trend, current_price, holdings, balance_usdc,
            )
            log.info("  %s → %s | %s", token, action, reason)

            if action == "HOLD":
                continue

            trade_entry = {
                "timestamp":  datetime.datetime.utcnow().isoformat() + "Z",
                "cycle":      cycle,
                "mode":       "paper" if paper_mode else "live",
                "token":      token,
                "action":     action,
                "price_usdc": current_price,
                "trend_pct":  round(trend * 100, 4),
                "reason":     reason,
            }

            if paper_mode and wallet:
                if action == "BUY":
                    bought = wallet.buy(token, trade_usdc, current_price)
                    trade_entry["usdc_spent"]    = round(trade_usdc, 6)
                    trade_entry["tokens_bought"] = round(bought, 6)
                    log.info(
                        "  [PAPER] BUY  %.6f %s for $%.4f USDC @ $%.6f",
                        bought, token, trade_usdc, current_price,
                    )
                elif action == "SELL":
                    sell_tokens   = holdings
                    usdc_received = wallet.sell(token, sell_tokens, current_price)
                    trade_entry["tokens_sold"]   = round(sell_tokens, 6)
                    trade_entry["usdc_received"] = round(usdc_received, 6)
                    log.info(
                        "  [PAPER] SELL %.6f %s for $%.4f USDC @ $%.6f",
                        sell_tokens, token, usdc_received, current_price,
                    )
                save_trade(trade_entry)

            else:
                # Live path — get quote → build tx → sign & send
                if action == "BUY":
                    raw_in = usdc_to_raw(trade_usdc)
                    quote  = get_quote(TOKENS["USDC"], TOKENS[token], raw_in)
                elif action == "SELL":
                    raw_in = int(holdings * 10 ** TOKEN_DECIMALS[token])
                    quote  = get_quote(TOKENS[token], TOKENS["USDC"], raw_in)
                else:
                    quote = None

                if quote and public_key:
                    swap_resp = build_live_swap_transaction(quote, public_key)
                    if swap_resp:
                        tx_sig = sign_and_send_transaction(
                            swap_resp,
                            os.getenv("PRIVATE_KEY", ""),
                        )
                        trade_entry["tx_signature"] = tx_sig
                        log.info("  [LIVE] Trade sent — sig: %s", tx_sig)
                    else:
                        log.error("  [LIVE] Failed to build swap transaction")
                else:
                    log.warning("  [LIVE] No quote or no public key — skipping")

                save_trade(trade_entry)

        log.info("  Sleeping %ds...", LOOP_INTERVAL_SECONDS)
        print()
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
        trades = load_trade_log()
        log.info("Total trades logged: %d  (see trades.json)", len(trades))
        sys.exit(0)
