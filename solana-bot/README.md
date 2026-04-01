# Solana Jupiter Trading Bot — Educational / Paper Mode

A beginner-friendly, educational Python trading bot for Solana using the
Jupiter aggregator. **Paper mode is on by default — no real money moves.**

---

## ⚠️ CRITICAL RISK WARNINGS

Before you read anything else, understand these risks:

| Risk | Details |
|---|---|
| **Total loss** | Crypto is volatile. You can lose 100% of your investment. |
| **Irreversible** | Blockchain transactions cannot be undone. There is no "undo". |
| **Smart contract bugs** | Bugs can drain your wallet with no recourse. |
| **Bot bugs** | Automated bots can make repeated mistakes extremely fast. |
| **Slippage & fees** | You often receive less than the quoted price. |
| **RPC failures** | Network nodes go down; your bot may miss trades or fail silently. |
| **Private key theft** | Anyone who sees your private key owns your wallet forever. |

**Only ever use money you can afford to lose entirely. Start in paper mode.**

---

## Quick Start

### 1. Install Python dependencies

```bash
cd solana-bot
pip install -r requirements.txt
```

### 2. Set up your environment

```bash
cp .env.example .env
```

Open `.env`. By default `PAPER_MODE=true` — leave it that way to start.

### 3. Run the bot in paper mode

```bash
python bot.py
```

The bot will start with a virtual **$20 USDC** balance and simulate trades
every 10 seconds using real Jupiter price quotes. No real money moves.

---

## What the Bot Does

1. **Fetches real prices** — Calls the Jupiter Quote API every 10 seconds for
   SOL, JUP, and BONK against USDC.

2. **Tracks momentum** — Keeps a 6-cycle rolling window of prices and
   calculates simple trend percentage.

3. **Makes decisions**:
   - **BUY** if trend > 0.5% and you have USDC available
   - **SELL** if trend < -0.5% and you hold the token
   - **HOLD** otherwise

4. **Safety checks** every cycle:
   - Max 50% of balance per trade
   - Circuit breaker: stops if balance drops below $5
   - Skips opportunities smaller than 0.5% profit

5. **Logs everything** to `trades.json` and `bot.log`.

---

## Safety Features

| Feature | Value |
|---|---|
| Paper mode (default) | `true` — virtual money only |
| Max risk per trade | 50% of current balance |
| Circuit breaker | Stops trading below $5 |
| Min opportunity | 0.5% trend required |
| Trade size | $5 USDC per trade |

---

## File Structure

```
solana-bot/
├── bot.py           ← Main bot (read this to learn!)
├── requirements.txt ← Python packages to install
├── .env.example     ← Copy to .env, fill in values
├── .gitignore       ← Keeps your .env out of git
├── trades.json      ← Auto-created — trade log
└── bot.log          ← Auto-created — runtime log
```

---

## Understanding the Code

The bot is split into clear sections:

- **`PriceHistory`** — tracks rolling price windows for each token
- **`decide_trade()`** — the strategy logic (easy to modify and experiment with)
- **`PaperWallet`** — simulates buying/selling without real funds
- **`get_quote()`** — calls Jupiter's Quote API for real market prices
- **`run_bot()`** — the main loop

The live trading path (`build_live_swap_transaction`, `sign_and_send_transaction`)
is intentionally left as a **stub** to prevent accidental real trades.

---

## Enabling Live Mode (ADVANCED — High Risk)

Only proceed after you fully understand all the risks above.

1. Set `PAPER_MODE=false` in `.env`
2. Set `WALLET_PUBLIC_KEY` in `.env` (your Phantom wallet address)
3. Set `PRIVATE_KEY` in `.env` (your Phantom private key — **never share this**)
4. Implement `sign_and_send_transaction()` in `bot.py` (currently a stub)
5. Use a **dedicated wallet** with only the funds you can afford to lose
6. Test with the absolute minimum amount first

**The author of this code assumes no responsibility for any financial losses.**

---

## Disclaimer

This software is provided for **educational purposes only**. It is not
financial advice. Trading cryptocurrencies involves substantial risk of loss.
Past performance does not guarantee future results. The developers are not
responsible for any losses incurred using this software.
