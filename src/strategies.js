/**
 * strategies.js — the strategy registry (pure, no DOM). Reads config/strategies.json (via web/generated/strategies-config.js)
 * and says which strategies exist, which are switched on, how each one trades, and how to get its signals.
 *
 * Loaded by web/index.html (as window.TickStrategies) and by scripts/run-backtest.js / the tests (via require).
 *
 * A strategy entry in config/strategies.json:
 *   enabled  true / false          switched on by default (the page lists it, the back-test runs it)
 *   title    short display name
 *   summary  one or two plain sentences
 *   signals  which signal generator it uses — a key of SIGNALS below (no key => "no rules yet")
 *   conditions  the entry rules of this strategy, shaped by its generator (SB_Bhanusali has none: its rules are in htf.json / ltf.json)
 *   trade    stop_multiple, target_multiple, round_trip_cost_points, no_entry_from, hard_exit_at
 *            (validated by TickTrade.normalizeStrategy; the same fields the old config/strategy.json had)
 *
 * Signals have the shape trade-sim.js expects: { time, pattern: 'A' (long) | 'B' (short), eDistance (risk, points),
 * windowCloseTime? }.
 *
 * Adding a strategy = one entry in config/strategies.json + one generator in SIGNALS.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./trade-sim.js'));
  else root.TickStrategies = factory(root.TickTrade);
}(typeof self !== 'undefined' ? self : this, function (TT) {
  'use strict';

  /**
   * Signal generators — each has:
   *   needs      'chain'   the HTF-zone + C1..C5 chain result (ctx.chain)   |   'candles'  the LTF candles only (ctx.candles)
   *   normalize  (entry's raw `conditions`) -> { problems:[], cfg }          validates and reads the entry's own rules
   *   generate   (ctx, cfg) -> signals                                       [] when inputs are missing, never throws
   * `ctx` carries what the caller already computed for the session on screen / in the back-test:
   *   ctx.chain    the TL.runChain() result (HTF zones -> LTF C1..C5)
   *   ctx.candles  the LTF candles, ascending
   *   ctx.rsiArray the page's Wilder RSI function (confirmation.js rsiArray) so the chart and the strategy cannot disagree
   */
  var SIGNALS = {
    // SB_Bhanusali: the full-signal candles of the HTF-zone chain — the last active level (C1..C5, or C1..C6 when the
    // risk-range condition is on); ctx.chain.fullKind names it
    htf_ltf_chain: {
      needs: 'chain',
      normalize: function () { return { problems: [], cfg: null }; },     // its conditions live in config/htf.json and config/ltf.json
      generate: function (ctx) {
        if (!ctx || !ctx.chain || !ctx.chain.marks) return [];
        var kind = ctx.chain.fullKind || 'C1+C2+C3+C4+C5';
        return ctx.chain.marks.filter(function (m) { return m.kind === kind; });
      },
    },
  };

  /**
   * @returns {{mode:'active'|'error', strategies:Array, byName:Object, enabled:Array<string>, problems:Array<string>}}
   *   strategies[i] = { name, enabled, title, summary, signals, implemented, runnable, trade, problems }
   *     trade     — TickTrade.normalizeStrategy() result for the entry's `trade` section (null when absent)
   *     runnable  — implemented AND its trade rules are valid
   */
  function normalizeRegistry(raw) {
    var out = { mode: 'active', strategies: [], byName: {}, enabled: [], problems: [] };
    if (raw == null) {
      out.mode = 'error';
      out.problems.push('config not generated — run node scripts/build-config.js');
      return out;
    }
    if (typeof raw !== 'object' || raw.strategies == null || typeof raw.strategies !== 'object' || Array.isArray(raw.strategies)) {
      out.mode = 'error';
      out.problems.push('strategies must be an object of strategy entries');
      return out;
    }
    Object.keys(raw.strategies).forEach(function (name) {
      var e = raw.strategies[name];
      var s = { name: name, enabled: false, title: name, summary: '', signals: null, implemented: false, runnable: false, trade: null, conditions: null, problems: [] };
      if (e == null || typeof e !== 'object' || Array.isArray(e)) {
        s.problems.push(name + ': entry must be an object');
      } else {
        if (typeof e.enabled !== 'boolean') s.problems.push(name + ': enabled must be true or false');
        s.enabled = e.enabled === true;
        if (typeof e.title === 'string' && e.title) s.title = e.title;
        if (typeof e.summary === 'string') s.summary = e.summary;
        s.signals = typeof e.signals === 'string' ? e.signals : null;
        s.implemented = !!(s.signals && Object.prototype.hasOwnProperty.call(SIGNALS, s.signals));
        if (e.trade !== undefined) {
          // the strategy-level `enabled` is the registry switch; the trade rules themselves are always evaluated as "on"
          s.trade = TT.normalizeStrategy(Object.assign({}, e.trade, { enabled: true }));
          if (s.trade.mode === 'error') s.problems = s.problems.concat(s.trade.problems.map(function (p) { return name + ': ' + p; }));
        }
        if (s.implemented) {
          var cond = SIGNALS[s.signals].normalize(e.conditions);
          s.conditions = cond.cfg;
          if (cond.problems.length) s.problems = s.problems.concat(cond.problems.map(function (p) { return name + ': ' + p; }));
        }
        if (s.enabled && !s.implemented) s.problems.push(name + ': switched on but has no signal rules yet (signals: ' + JSON.stringify(s.signals) + ')');
        if (s.enabled && s.implemented && !s.trade) s.problems.push(name + ': switched on but has no "trade" section');
        s.runnable = s.implemented && !!s.trade && s.trade.mode === 'active' && !s.problems.length;
      }
      if (s.problems.length) out.problems = out.problems.concat(s.problems);
      out.strategies.push(s);
      out.byName[name] = s;
      if (s.enabled && s.runnable) out.enabled.push(name);
    });
    if (out.problems.length) out.mode = 'error';
    return out;
  }

  /** Signals of one registry entry for the data in `ctx`. */
  function signalsFor(entry, ctx) {
    if (!entry || !entry.implemented) return [];
    return SIGNALS[entry.signals].generate(ctx, entry.conditions);
  }

  return { normalizeRegistry: normalizeRegistry, signalsFor: signalsFor, SIGNALS: SIGNALS };
}));
