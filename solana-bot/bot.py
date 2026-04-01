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
"""

import os
import sys
import json
import time
import logging
import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

load_dotenv()

# ── Safety settings ──────────────────────────────────────────────────────────
PAPER_MODE = os.getenv("PAPER_MODE", "true").lower() in ("true", "1", "yes")
MAX_RISK_PER_TRADE_PCT = 0.50        # Never risk more than 50% of balance on one trade
CIRCUIT_BREAKER_USD = 5.00           # Stop trading if balance drops below $5
MIN_PROFIT_THRESHOLD_PCT = 0.005     # Skip opportunities smaller than 0.5% profit
SLIPPAGE_BPS = 50                    # 0.5% slippage tolerance (in basis points)
LOOP_INTERVAL_SECONDS = 10           # Check every 10 seconds
TRADE_AMOUNT_USD = 5.00              # How much USDC to use per trade (≤50% of balance)

# ── Starting paper balance ────────────────────────────────────────────────────
STARTING_PAPER_BALANCE_USDC = 20.00

# ── Token mint addresses on Solana mainnet ────────────────────────────────────
TOKENS = {
    "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "SOL":  "So11111111111111111111111111111111111111112",
    "BONK": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "JUP":  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    "WIF":  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
}

# ── Token decimals (needed to convert raw amounts) ────────────────────────────
TOKEN_DECIMALS = {
    "USDC": 6,
    "SOL":  9,
    "BONK": 5,
    "JUP":  6,
    "WIF":  6,
}

# ── Jupiter API ───────────────────────────────────────────────────────────────
JUPITER_QUOTE_URL = "https://quote-api.jup.ag/v6/quote"
JUPITER_SWAP_URL  = "https://quote-api.jup.ag/v6/swap"

# ── Trade log file ────────────────────────────────────────────────────────────
TRADE_LOG_FILE = Path("trades.json")

# ─────────────────────────────────────────────────────────────────────────────
# Logging setup
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
    """
    Fetch a swap quote from Jupiter.
    Returns the quote dict or None on error.
    """
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
    """
    Fetch the current price of a token denominated in USDC using Jupiter.
    We request a quote for 1 USDC → token, then invert.
    """
    if token_symbol == "USDC":
        return 1.0

    amount_usdc = 1.0
    raw_usdc = usdc_to_raw(amount_usdc)

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

    price_usdc = 1.0 / tokens_per_usdc
    return price_usdc


# ─────────────────────────────────────────────────────────────────────────────
# Simple momentum strategy (educational)
# ─────────────────────────────────────────────────────────────────────────────

class PriceHistory:
    """Tracks last N prices per token for basic momentum signals."""

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
        """
        Returns a simple % change from oldest to newest price in the window.
        Positive = uptrend, negative = downtrend.
        """
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
    """
    Very simple momentum strategy:
    - If trend > threshold and we have USDC → buy the token
    - If trend < -threshold and we hold the token → sell it back to USDC
    - Otherwise → hold

    Returns: (action, reason, trade_amount_usdc)
    action: "BUY" | "SELL" | "HOLD"
    """
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
    """Simulates a wallet with a USDC balance and token holdings."""

    def __init__(self, starting_usdc: float = STARTING_PAPER_BALANCE_USDC):
        self.usdc = starting_usdc
        self.holdings: dict[str, float] = {}

    def buy(self, token: str, usdc_amount: float, price: float) -> float:
        """Buy `usdc_amount` worth of token at `price`. Returns tokens bought."""
        if usdc_amount > self.usdc:
            usdc_amount = self.usdc
        tokens_bought = usdc_amount / price
        self.usdc -= usdc_amount
        self.holdings[token] = self.holdings.get(token, 0.0) + tokens_bought
        return tokens_bought

    def sell(self, token: str, token_amount: float, price: float) -> float:
        """Sell `token_amount` of token at `price`. Returns USDC received."""
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
            price = prices.get(token, 0)
            total += amount * price
        return total


# ─────────────────────────────────────────────────────────────────────────────
# Live trading stubs (educational, deliberately incomplete)
# ─────────────────────────────────────────────────────────────────────────────

def build_live_swap_transaction(
    quote: dict,
    user_public_key: str,
) -> dict | None:
    """
    Requests a serialized swap transaction from Jupiter.
    In live mode this would be signed and sent.
    For safety this only builds — it never signs or broadcasts here.
    """
    body = {
        "quoteResponse":          quote,
        "userPublicKey":          user_public_key,
        "wrapAndUnwrapSol":       True,
        "dynamicComputeUnitLimit": True,
        "prioritizationFeeLamports": "auto",
    }
    try:
        resp = requests.post(JUPITER_SWAP_URL, json=body, timeout=15)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        log.error("Failed to build swap tx: %s", exc)
        return None


def sign_and_send_transaction(
    swap_response: dict,
    private_key_b58: str,
) -> str | None:
    """
    !! LIVE TRADING !! Signs and sends a transaction to the Solana network.

    This function is intentionally left as a stub to prevent accidental live
    trading. To enable live trading, a developer should implement:

    1. Decode swap_response["swapTransaction"] from base64
    2. Deserialize into a VersionedTransaction using solders
    3. Sign with the private key
    4. Send via Solana RPC (sendTransaction)
    5. Confirm with getSignatureStatuses

    DO NOT implement this unless you fully understand the risks.
    """
    log.warning(
        "LIVE TRADING ATTEMPTED — sign_and_send_transaction is a stub. "
        "This trade was NOT executed on-chain."
    )
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Private key / wallet setup (for live mode only)
# ─────────────────────────────────────────────────────────────────────────────

def load_wallet_public_key() -> str | None:
    """
    In a real implementation this would derive the public key from PRIVATE_KEY.
    We only read WALLET_PUBLIC_KEY from .env to avoid handling private keys here.

    NEVER log, print, or share your PRIVATE_KEY.
    """
    pk = os.getenv("WALLET_PUBLIC_KEY", "")
    if pk:
        return pk
    log.warning(
        "WALLET_PUBLIC_KEY not set in .env — live trading disabled. "
        "Paper mode is active regardless."
    )
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Main bot loop
# ─────────────────────────────────────────────────────────────────────────────

def print_banner():
    print("=" * 72)
    print("  SOLANA JUPITER TRADING BOT — EDUCATIONAL VERSION")
    print("=" * 72)
    print()
    if PAPER_MODE:
        print("  ✅  PAPER MODE ACTIVE — No real money is at risk")
        print(f"  Starting virtual balance: ${STARTING_PAPER_BALANCE_USDC:.2f} USDC")
    else:
        print("  ⚠️  ⚠️  ⚠️  LIVE MODE ACTIVE — REAL MONEY AT RISK ⚠️  ⚠️  ⚠️")
        print()
        print("  You have chosen to run this bot with real funds.")
        print("  This bot is experimental. You can lose everything.")
        print("  Press Ctrl+C within 5 seconds to cancel.")
        print()
        for i in range(5, 0, -1):
            print(f"  Starting in {i}...", end="\r")
            time.sleep(1)
        print()
    print()
    print("  RISK REMINDERS:")
    print("  - Max risk per trade: 50% of balance")
    print(f"  - Circuit breaker stops trading below: ${CIRCUIT_BREAKER_USD:.2f}")
    print(f"  - Min opportunity threshold: {MIN_PROFIT_THRESHOLD_PCT*100:.1f}%")
    print("  - Trades are logged to trades.json")
    print()
    print("  Press Ctrl+C to stop the bot at any time.")
    print("=" * 72)
    print()


FOCUS_TOKENS = ["SOL", "JUP", "BONK"]  # tokens to watch (all vs USDC)


def run_bot():
    print_banner()

    wallet = PaperWallet() if PAPER_MODE else None
    history = PriceHistory(window=6)
    public_key = None if PAPER_MODE else load_wallet_public_key()

    cycle = 0
    while True:
        cycle += 1
        log.info("─── Cycle %d ──────────────────────────────────────────", cycle)

        # 1. Fetch current prices
        prices: dict[str, float] = {}
        for token in FOCUS_TOKENS:
            price = get_token_price_in_usdc(token)
            if price is not None:
                prices[token] = price
                history.update(token, price)
                log.info("  %s price: $%.6f USDC", token, price)
            else:
                log.warning("  Could not fetch price for %s", token)

        # 2. Report paper wallet state
        if PAPER_MODE and wallet:
            total = wallet.total_value_usdc(prices)
            log.info(
                "  Paper wallet — USDC: $%.4f | Holdings: %s | Total: $%.4f",
                wallet.usdc,
                {t: f"{a:.4f}" for t, a in wallet.holdings.items()},
                total,
            )

            # Circuit breaker
            if wallet.usdc < CIRCUIT_BREAKER_USD and not wallet.holdings:
                log.error(
                    "  🚨 CIRCUIT BREAKER TRIGGERED — balance ($%.4f) below $%.2f. "
                    "Stopping bot to prevent further losses.",
                    wallet.usdc,
                    CIRCUIT_BREAKER_USD,
                )
                break

        # 3. Decide & execute trades
        for token in FOCUS_TOKENS:
            if token not in prices:
                continue

            trend = history.trend(token)
            if trend is None:
                log.info("  %s: not enough price history yet, skipping", token)
                continue

            current_price = prices[token]
            holdings = wallet.holdings.get(token, 0.0) if (PAPER_MODE and wallet) else 0.0
            balance_usdc = wallet.usdc if (PAPER_MODE and wallet) else 0.0

            action, reason, trade_usdc = decide_trade(
                token, trend, current_price, holdings, balance_usdc
            )

            log.info(
                "  %s → %s | reason: %s",
                token,
                action,
                reason,
            )

            if action == "HOLD":
                continue

            # ── Execute trade ───────────────────────────────────────────────
            trade_entry = {
                "timestamp":    datetime.datetime.utcnow().isoformat() + "Z",
                "cycle":        cycle,
                "mode":         "paper" if PAPER_MODE else "live",
                "token":        token,
                "action":       action,
                "price_usdc":   current_price,
                "trend_pct":    round(trend * 100, 4),
                "reason":       reason,
            }

            if PAPER_MODE and wallet:
                if action == "BUY":
                    tokens_bought = wallet.buy(token, trade_usdc, current_price)
                    trade_entry["usdc_spent"]    = round(trade_usdc, 6)
                    trade_entry["tokens_bought"] = round(tokens_bought, 6)
                    log.info(
                        "  [PAPER] BUY  %.4f %s for $%.4f USDC @ $%.6f",
                        tokens_bought, token, trade_usdc, current_price,
                    )

                elif action == "SELL":
                    sell_tokens = holdings
                    usdc_received = wallet.sell(token, sell_tokens, current_price)
                    trade_entry["tokens_sold"]    = round(sell_tokens, 6)
                    trade_entry["usdc_received"]  = round(usdc_received, 6)
                    log.info(
                        "  [PAPER] SELL %.4f %s for $%.4f USDC @ $%.6f",
                        sell_tokens, token, usdc_received, current_price,
                    )

                save_trade(trade_entry)

            else:
                # Live trading path (quote only — sending is a stub)
                raw_usdc = usdc_to_raw(trade_usdc)
                if action == "BUY":
                    quote = get_quote(TOKENS["USDC"], TOKENS[token], raw_usdc)
                elif action == "SELL":
                    raw_token = int(holdings * 10 ** TOKEN_DECIMALS[token])
                    quote = get_quote(TOKENS[token], TOKENS["USDC"], raw_token)
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
                        log.info("  [LIVE] Trade built (tx_sig=%s)", tx_sig)
                    else:
                        log.error("  [LIVE] Failed to build swap transaction")
                else:
                    log.warning("  [LIVE] No quote or no public key — skipping trade")

                save_trade(trade_entry)

        log.info("  Sleeping %ds...", LOOP_INTERVAL_SECONDS)
        print()
        time.sleep(LOOP_INTERVAL_SECONDS)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    try:
        run_bot()
    except KeyboardInterrupt:
        log.info("Bot stopped by user (Ctrl+C). Goodbye!")
        trades = load_trade_log()
        log.info("Total trades logged: %d  (see trades.json)", len(trades))
        sys.exit(0)
