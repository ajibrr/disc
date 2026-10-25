# Strategies — the registry and how to add one

All strategies live in one file, [config/strategies.json](../config/strategies.json). Each entry says, in plain terms, whether the strategy is on, what it is, which signal rules it uses and how it trades.

```json
"SB_Bhanusali": {
  "enabled": true,
  "title": "SB Bhanusali",
  "summary": "Wait for an HTF Pattern A / B candle, then take the first LTF candle that passes all five conditions (C1 to C5). Pattern A is a long, Pattern B a short.",
  "signals": "htf_ltf_chain",
  "trade": { "stop_multiple": 1, "target_mode": "previous_extreme", "target_multiple": 2, "round_trip_cost_points": 0, "no_entry_from": "15:10", "hard_exit_at": "15:19" }
}
```

| Field | Meaning |
|---|---|
| `enabled` | `true` = shown as selectable on the page and run by the back-test by default. `false` = listed but off. |
| `conditions` | The strategy's own entry rules (the shape depends on its generator). SB_Bhanusali has none here: its conditions live in `config/htf.json` and `config/ltf.json`. |
| `title`, `summary` | Names and one-line description shown on the page (the summary is the tooltip). |
| `signals` | Which signal generator it uses (a key in `src/strategies.js`). A name with no generator means "rules not defined yet" and the strategy cannot be switched on. |
| `trade` | Stop, target, cost and the session clock rules — see [strategy.md](strategy.md) §5–6. `target_mode` is `previous_extreme` (target = the signal's back high / low) or `multiple` (target = `target_multiple` × the E distance). |

## The strategies today

| Name | State | What it is |
|---|---|---|
| **SB_Bhanusali** | **on** | HTF Pattern A / B zone, then the LTF C1 → C5 chain. Full rules: [algorithm.md](algorithm.md), [strategy.md](strategy.md). |

The signal conditions themselves (HTF slope and RSI filters, C1–C5 thresholds) still live in `config/htf.json` and `config/ltf.json`; they belong to the *signal generator* `htf_ltf_chain`, not to a single strategy entry.

## Using it

```bash
node scripts/build-config.js                              # after editing config/strategies.json
node scripts/run-backtest.js                              # every strategy that is switched on
node scripts/run-backtest.js --strategy SB_Bhanusali      # one strategy
node scripts/run-backtest.js --strategy all               # every strategy that can run, on or off
node scripts/run-backtest.js --set strategy.target_mode=multiple --set strategy.target_multiple=3   # what-if on the trade rules of the selected strategies
```

On the page, the **Strategy** drop-down in the toolbar chooses which strategy's trades are simulated and drawn (entry squares, TP / SL circles, the badge). Strategies that are off or have no rules are listed but greyed out. The C1–C5 arrows do not depend on the choice.

## Adding a strategy

1. Add an entry to `config/strategies.json` with `"enabled": false`, a `signals` key, a `conditions` section (its own entry rules) and a `trade` section.
2. Add a generator with that key to `SIGNALS` in `src/strategies.js`: `needs` (`'chain'` or `'candles'`), `normalize(conditions)` to validate the entry rules, and `generate(ctx, cfg)`. It returns signals in the shape `trade-sim.js` already uses: `{ time, pattern: 'A' (long) | 'B' (short), eDistance (the risk, in points), windowCloseTime? }`. The stop and target are `stop_multiple` / `target_multiple` × `eDistance` from the entry price.  `htf_ltf_chain` (SB_Bhanusali) is the existing example.
3. If it needs more inputs than the chain and the LTF candles, extend the `ctx` object that `run-backtest.js` and `index.html` pass to `TS.signalsFor`.
4. Add tests (see `tests/strategies.test.js`), run `node scripts/build-config.js`, then set `enabled` to `true`.

A strategy that is switched on without a generator, or with invalid `trade` rules, makes the registry report an error and the page shows `Strategy: Config error`.
