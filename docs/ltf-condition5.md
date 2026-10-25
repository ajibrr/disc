# LTF Condition 5 — Distance Ratio (E Candle vs Back Candle)

> **Status: IMPLEMENTED and verified for Pattern A and Pattern B** — config block `condition_5_distance_ratio` in
> [config/ltf.json](../config/ltf.json) · code `evaluateCondition5` in [src/ltf-conditions.js](../src/ltf-conditions.js) ·
> tests [tests/ltf-condition5.test.js](../tests/ltf-condition5.test.js).
> Part of the LTF condition chain C1 → C5 — see [ltf-pattern.md](ltf-pattern.md) for the whole chain
> and [ltf.md](design/ltf-conditions-plan.md) for the per-condition specs.

---

## 1. What it does

Condition 5 filters the candles that already passed **C1 + C2 + C3 + C4**. (The *back high* / *back low* it finds is also the **profit target** of the trade — see [strategy.md](strategy.md) §6.) It asks one question:

> Is there still **more than twice as much room** between the E candle and the recent high (Pattern A) or recent low
> (Pattern B) as the size of the E candle's own move?

A candle that passes gets a pink **`C1+C2+C3+C4+C5`** arrow; a candle that fails keeps its **`C1+C2+C3+C4`** arrow.
Condition 5 only filters — it never creates an arrow of its own.

---

## 2. Terms

| Term | Meaning |
|---|---|
| **E candle** | the LTF candle that carries the **`C1+C2+C3+C4`** arrow (A or B) — the candle being tested |
| **E−1 candle** | the LTF candle **immediately before** the E candle |
| **Back window** | the **N candles before the E candle** — the E candle excluded, the E−1 candle included. **N = `back_candles`** (configurable, 20 by default) |
| **Back high** *(Pattern A)* | the highest **high** price in the back window |
| **Back low** *(Pattern B)* | the lowest **low** price in the back window |
| **E candle distance** | how big the E candle's move is across the last two candles — formula per pattern, section 3 |
| **Back candle distance** | how far the E candle is from the recent extreme (back high / back low) — formula per pattern, section 3 |

---

## 3. The rule

| | **Pattern A** (high side) | **Pattern B** (low side — the exact mirror) |
|---|---|---|
| **E candle distance** | **E high − E−1 low** | **E−1 high − E low** |
| **Back candle distance** | **back high − E high** | **E low − back low** |
| **Rule (strict)** | **back candle distance  >  `distance_multiplier` × E candle distance** | **back candle distance  >  `distance_multiplier` × E candle distance** |
| **In symbols** | `(back high − E high) > 2 × (E high − E−1 low)` | `(E low − back low) > 2 × (E−1 high − E low)` |
| **In words** | the E candle's high sits more than twice as far **below** the recent top as it sits above the previous candle's low | the E candle's low sits more than twice as far **above** the recent bottom as it sits below the previous candle's high |
| **Arrow if it passes** | `C1+C2+C3+C4+C5 A` — pink ⬆ below the candle | `C1+C2+C3+C4+C5 B` — pink ⬇ above the candle |
| **Arrow if it fails** | stays `C1+C2+C3+C4 A` | stays `C1+C2+C3+C4 B` |

- **Strict** comparison: exactly equal fails, like every other rule in the project.
- **Units:** both distances are in points, so the rule is a plain ratio and works the same for NIFTY and SENSEX.
- **No look-ahead:** only the E candle and candles before it are read.

**Fails automatically when**

| Case | Why |
|---|---|
| E candle distance ≤ 0 | the E candle gapped past the previous candle, so the ratio is meaningless |
| Back candle distance ≤ 0 | nothing beyond the E candle in the back window — there is no room |
| No E−1 candle (the first candle of the session) | the E candle distance cannot be worked out |

With fewer than N candles before the E candle (early session), the candles that exist are used.

---

## 4. Settings — `condition_5_distance_ratio` in `config/ltf.json`

```json
"condition_5_distance_ratio": { "enabled": true, "back_candles": 20, "distance_multiplier": 2 }
```

| Setting | Value | Meaning |
|---|---|---|
| `enabled` | true | `false` removes Condition 5 (arrows stay at `C1+C2+C3+C4`) |
| `back_candles` | 20 | N — how many candles before the E candle make the back window (integer ≥ 1) |
| `distance_multiplier` | 2 | the "2" in the rule (number > 0) |

Both patterns share the same two numbers (separate Pattern B values can be added if wanted).
After editing: `node scripts/build-config.js`, then **reload the page**. An invalid block fails closed — the readout shows the problem.

---

## 5. What you see

| Element | Meaning |
|---|---|
| Pink ⬆ `C1+C2+C3+C4+C5 A` below a candle | Pattern A E candle that passed Condition 5 |
| Pink ⬇ `C1+C2+C3+C4+C5 B` above a candle | Pattern B E candle that passed Condition 5 |
| Green / red `C1+C2+C3+C4 A / B` arrow | E candle that failed Condition 5 (or Condition 5 is off) |
| `C5` chip in the LTF readout (hover a zone) | `⬆ 12:58:48  back 44.20 > 2 × e 15.40`, or `none` |

---

## 6. Worked examples (real data)

**Pattern A passes — NIFTY, 22-10-2026, 12s LTF, E candle 12:58:48**

| Step | Value |
|---|---|
| E high / E−1 low | 22711.75 / 22696.35 → **E candle distance = 15.40** |
| Back high (previous 20 candles) | 22755.95 at 12:55:48 → **back candle distance = 22755.95 − 22711.75 = 44.20** |
| Rule | 44.20 **>** 2 × 15.40 = 30.80 ✓ |
| Arrow | **`C1+C2+C3+C4+C5 A`** |

**Pattern A fails — NIFTY, 23-10-2026, E candle 12:16:48:** E candle distance 12.55 (needs back > 25.10) but the recent top is only
7.05 above the E high → stays `C1+C2+C3+C4 A`.

**Pattern B passes — NIFTY, 22-10-2026, E candle 12:15:12**

| Step | Value |
|---|---|
| E−1 high / E low | 22614.55 / 22608.25 → **E candle distance = 6.30** |
| Back low (previous 20 candles) | 22589.95 at 12:12:00 → **back candle distance = 22608.25 − 22589.95 = 18.30** |
| Rule | 18.30 **>** 2 × 6.30 = 12.60 ✓ |
| Arrow | **`C1+C2+C3+C4+C5 B`** |

---

## 7. Real data — every E candle that exists today

Shipped `config/ltf.json` and `config/htf.json`, N = 20, multiplier 2. All on the 12s LTF chart. The numbers change if either config changes.

**Pattern A — 5 of 7 pass**

| Instrument, date | E candle (IST) | E high | E−1 low | E candle distance | 2 × | Back high (candle) | Back candle distance | Result |
|---|---|---|---|---|---|---|---|---|
| NIFTY 2026-10-15 | 11:44:48 *(inside a zone)* | 22964.60 | 22958.60 | 6.00 | 12.00 | 22972.10 (11:42:12) | 7.50 | **✗ fails** |
| NIFTY 2026-10-22 | 12:58:48 | 22711.75 | 22696.35 | 15.40 | 30.80 | 22755.95 (12:55:48) | 44.20 | **✓ passes** |
| NIFTY 2026-10-23 | 12:16:48 | 22443.20 | 22430.65 | 12.55 | 25.10 | 22450.25 (12:14:36) | 7.05 | **✗ fails** |
| NIFTY 2026-10-23 | 13:36:12 | 22431.40 | 22424.05 | 7.35 | 14.70 | 22448.80 (13:33:12) | 17.40 | **✓ passes** |
| SENSEX 2026-10-22 | 12:58:49 | 73450.44 | 73397.60 | 52.84 | 105.68 | 73583.68 (12:55:49) | 133.24 | **✓ passes** |
| SENSEX 2026-10-23 | 12:16:48 | 72650.07 | 72633.86 | 16.21 | 32.42 | 72686.93 (12:14:12) | 36.86 | **✓ passes** |
| SENSEX 2026-10-23 | 13:36:36 | 72629.23 | 72612.94 | 16.29 | 32.58 | 72677.19 (13:33:12) | 47.96 | **✓ passes** |

**Pattern B — 6 of 8 pass**

| Instrument, date | E candle (IST) | E low | E−1 high | E candle distance | 2 × | Back low (candle) | Back candle distance | Result |
|---|---|---|---|---|---|---|---|---|
| NIFTY 2026-10-22 | 11:39:48 | 22724.60 | 22728.75 | 4.15 | 8.30 | 22709.75 (11:38:00) | 14.85 | **✓ passes** |
| NIFTY 2026-10-22 | 12:15:12 | 22608.25 | 22614.55 | 6.30 | 12.60 | 22589.95 (12:12:00) | 18.30 | **✓ passes** |
| NIFTY 2026-10-23 | 12:00:48 *(inside a zone)* | 22427.35 | 22431.35 | 4.00 | 8.00 | 22411.40 (11:58:00) | 15.95 | **✓ passes** |
| SENSEX 2026-10-22 | 12:15:13 | 73147.70 | 73164.76 | 17.06 | 34.12 | 73080.64 (12:12:01) | 67.06 | **✓ passes** |
| SENSEX 2026-10-22 | 12:15:37 | 73145.55 | 73151.94 | 6.39 | 12.78 | 73080.64 (12:12:01) | 64.91 | **✓ passes** |
| SENSEX 2026-10-23 | 12:01:00 | 72622.47 | 72633.80 | 11.33 | 22.66 | 72577.18 (11:58:00) | 45.29 | **✓ passes** |
| SENSEX 2026-10-23 | 12:30:36 | 72594.99 | 72617.20 | 22.21 | 44.42 | 72566.14 (12:28:12) | 28.85 | **✗ fails** |
| SENSEX 2026-10-23 | 12:31:48 | 72586.53 | 72602.83 | 16.30 | 32.60 | 72566.14 (12:28:12) | 20.39 | **✗ fails** |

---

## 8. Decisions made

| Question | Decision |
|---|---|
| Is the distance only displayed, or a condition? | **A condition**: back candle distance > multiplier × E candle distance. |
| Units | None needed — a ratio of two distances in the same units. |
| What is E−1? | The candle immediately before the E candle. |
| Formula direction for the back candle distance | Pattern A: back high − E high. Pattern B: E low − back low. |
| Where does the back window sit? | The N candles before the E candle; E excluded, E−1 included. |
| Is the candle count fixed? | No — `back_candles` in `config/ltf.json` (20 by default). |
| Is the multiplier fixed? | No — `distance_multiplier` in `config/ltf.json` (2 by default). |
| What happens to an E candle that fails? | It keeps its `C1+C2+C3+C4` arrow; a passing one gets `C1+C2+C3+C4+C5`. |
| E candle distance ≤ 0 | Fails. |
| Pattern B | The exact mirror of Pattern A, sharing the same two settings. |

---

## 9. Tests

```bash
node tests/ltf-condition5.test.js   # config, the rule for A and B, window, edge cases, real-data brute-force check
```
