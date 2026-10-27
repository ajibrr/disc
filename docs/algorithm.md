# Algorithm — one-page reference

The whole strategy on one page. Details and reasoning live in the linked documents; every number below is a **setting** in `config/*.json` (shipped value shown).
This is a **simulation** over recorded sessions — no live trading.

## 1. Pipeline

```
ticks (1 / second)
   │  build candles: LTF 12s / 36s   ·   HTF = 5 × LTF  (1m / 3m)
   ▼
HTF  ── per completed candle ──►  Pattern A / Pattern B / none            [htf-pattern.md]
   │   zone = the 5 LTF candles under a Matched HTF candle (revealed at the HTF close)
   ▼
LTF  ── inside / after the zone ──►  C1 → … → C6               [ltf-pattern.md]
   │   a candle passing all six = signal candle ("E candle")
   ▼
ENTRY  next candle's open   →   STOP / TARGET from the E candle distance   →   EXIT      [strategy.md]
```

## 2. HTF — Pattern A / B (`config/htf.json`)

A completed HTF candle is **Matched** when every enabled layer passes (A = bullish-structure side, B = mirror image):

| # | Layer | Pattern A | Pattern B | Shipped |
|---|---|---|---|---|
| 1 | Five-candle shape (fixed rules) | two red candles, second lower on high **and** low, after a recent high | two green candles, second higher on high **and** low, after a recent low | – |
| 2 | `sma_slope_filter`: ATR-normalized slope of SMA 9, lookback 3 | slope **>** `minimum_slope` | slope **<** −`minimum_slope` | on, 0.25 |
| 3 | `sma_rsi_filter`: SMA 14 of RSI 14 | **<** `pattern_a_max` | **>** `pattern_b_min` | on, 65 / 35 |
| 4 | `oi_change_filter`: CE / PE open-interest change | PE − CE **>** `minimum_difference` | CE − PE **>** `minimum_difference` | **off** — see [analysis.md](analysis.md) §2 |

All comparisons are strict. Not enough history ⇒ *Unavailable*.

## 3. LTF — condition chain (`config/ltf.json`)

Each condition filters the previous one. The search span is the crossing candle's position counted from the zone's first candle: `scan_min_candles` … `scan_max_candles` = 1 … 20.

| # | Condition | Pattern A | Pattern B | Shipped |
|---|---|---|---|---|
| C1 | RSI 14 crosses 50 | previous < 50, now > 50 | previous > 50, now < 50 | level 50 |
| C2 | SMA 9 vs SMA 44 | 9 **>** 44 | 9 **<** 44 | 9 / 44 |
| C3 | spread % = (SMA 9 − SMA 44) ÷ SMA 44 × 100 | 0 < spread ≤ +`max_pct` | −`max_pct` ≤ spread < 0 | 0 … 0.02 |
| C4 | SMA 14 of RSI 14, **any** of the candles `lookback_min_candles` … `lookback_max_candles` before the arrow | `pattern_a_min` **<** value **≤** `pattern_a_max` | `pattern_b_min` **≤** value **<** `pattern_b_max` | look-back 1 … 20 · A 67.5 … 100 · B 0 … 32.5 |
| C5 | back distance **>** multiplier × E distance (highest high / lowest low of the previous 20 candles) | A: E distance = E high − (E−1) low; back = back high − E high | B: E distance = (E−1) high − E low; back = E low − back low | ×2 |
| C6 | **risk range** — the E distance (= the trade's risk, the stop distance) | `min_risk_points` **≤** E distance **<** `max_risk_points` | the same range | **3.5** to **8** points |

Only a candle with all six (`C1+C2+C3+C4+C5+C6`) is a signal — every trade therefore risks between 3.5 and 8 points, long or short. Pattern A ⇒ **LONG**, Pattern B ⇒ **SHORT**.

## 4. Trade rules (`config/strategies.json` → `SB_Bhanusali.trade`)

| Rule | Value |
|---|---|
| Entry | the open of the first candle that opens at or after **both** the E candle's close **and** the HTF zone's close (normally the next candle) |
| No entry | from **15:10 IST** (`no_entry_from`); no next candle ⇒ no trade |
| Positions | one at a time; a signal whose entry falls inside an open trade is skipped |
| Risk unit | **E candle distance** (points) |
| Stop | entry ∓ `stop_multiple` (1) × E distance — long below, short above |
| Target | long = entry + `target_multiple` × E distance, short = entry − `target_multiple` × E distance, from `config/strategies.json` only (C5's back high / low is a filter, not a target) |
| Which is hit first | second-by-second ticks are replayed after the entry |
| Hard exit | **15:19 IST** (`hard_exit_at`), at the first tick at or after that time |
| Fill / cost | exactly at the level; `round_trip_cost_points` (0) per trade |
| Size / unit | 1 unit, results in points; **R** = P&L ÷ E distance |

## 5. Run it

```bash
node scripts/build-config.js    # after any change in config/*.json (regenerates the bundles the page reads)
node scripts/build-data.js      # after adding files to input/
node scripts/run-backtest.js    # all sessions: hit ratio, P&L, drawdown …   (add --trades, --json, --ltf 12,36, --set key=value)
open web/index.html         # the charts
```

## 6. Where to read more

| Topic | Document |
|---|---|
| HTF rules in plain language, with examples | [htf-pattern.md](htf-pattern.md) |
| LTF C1–C5 in plain language, with examples | [ltf-pattern.md](ltf-pattern.md) · [ltf-condition5.md](ltf-condition5.md) |
| Entry, exit, statistics, results | [strategy.md](strategy.md) |
| Findings and next steps | [analysis.md](analysis.md) |
| Why it was built this way | [design/](design/) |
