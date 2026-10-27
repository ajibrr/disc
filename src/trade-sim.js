/**
 * trade-sim.js — strategy simulation (pure, no DOM, no chart library). See strategy.md.
 *
 * Loaded by web/index.html (as window.TickTrade) and by the tests / back-test runner (via require).
 *
 * Rules (strategy.md sections 4-6):
 *   Signal   = a candle with the full C1+C2+C3+C4+C5 arrow (the "E candle").
 *   Pattern A -> LONG, Pattern B -> SHORT.
 *   Entry    = the OPEN of the first candle that starts at or after BOTH the E candle's close AND the close of the HTF
 *              zone the signal belongs to (`windowCloseTime`). Normally that is simply the candle right after the E candle;
 *              when the E candle sits inside the zone, the pattern is only known at the zone's HTF close, so the entry waits
 *              for it — otherwise the trade would use information from the future.
 *   Risk     = the E candle distance of the signal (points).
 *   Stop     = entry -/+ stop_multiple   x risk   (long / short)      (default 1)
 *   Target   = entry +/- target_multiple x risk   (long / short) — taken ONLY from config/strategies.json. (Condition 5's back high /
 *              back low is a FILTER on the signal, never a target.)
 *   Exit     = whichever of stop / target the second-by-second ticks reach FIRST (so a stop and a target inside
 *              one candle are resolved by replaying the ticks, not guessed); otherwise the last tick of the session.
 *   Fills    = exactly at the stop / target price (no slippage); an optional fixed round-trip cost in points.
 *   Session rules (IST): no new entry at or after `no_entry_from` (15:10) and a HARD EXIT at `hard_exit_at` (15:19) —
 *              any trade still open at that time is closed at the price of the first tick at or after it.
 *   One position at a time: a signal whose entry would fall inside the open trade is skipped.
 *   No such candle (the signal is on the last candles of the session) -> no trade.
 *   Results are in POINTS for a size of 1 unit.
 *
 * A trade only ever uses ticks at or after its entry candle, so there is no look-ahead.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TickTrade = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** off / active / error — same contract as the LTF conditions. */
  function normalizeStrategy(raw) {
    if (raw == null) {
      return { mode: 'error', cfg: null, problems: ['config not generated — run node scripts/build-config.js'] };
    }
    if (typeof raw !== 'object') return { mode: 'error', cfg: null, problems: ['config must be a JSON object'] };
    var sec = raw;
    if (sec.enabled === false) return { mode: 'off', cfg: null, problems: [] };
    var problems = [];
    var pos = function (v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; };
    if (sec.enabled !== true) problems.push('enabled must be a boolean (true or false)');
    if (!pos(sec.stop_multiple)) problems.push('stop_multiple must be a finite number > 0');
    // the target is always entry +/- target_multiple x risk; the old "previous_extreme" target mode was removed (Condition 5's previous high / low is a filter only)
    if (sec.target_mode !== undefined && sec.target_mode !== 'multiple') {
      problems.push('target_mode "' + sec.target_mode + '" is no longer supported: the target is always entry +/- target_multiple x risk — delete the target_mode line');
    }
    if (!pos(sec.target_multiple)) problems.push('target_multiple must be a finite number > 0');
    if (!(typeof sec.round_trip_cost_points === 'number' && Number.isFinite(sec.round_trip_cost_points) &&
          sec.round_trip_cost_points >= 0)) {
      problems.push('round_trip_cost_points must be a finite number >= 0');
    }
    var noEntrySec = sec.no_entry_from === undefined ? null : parseClock(sec.no_entry_from);   // absent = rule off
    var hardExitSec = sec.hard_exit_at === undefined ? null : parseClock(sec.hard_exit_at);
    if (noEntrySec === undefined) problems.push('no_entry_from must be a clock time "HH:MM" (IST) or null');
    if (hardExitSec === undefined) problems.push('hard_exit_at must be a clock time "HH:MM" (IST) or null');
    if (noEntrySec != null && hardExitSec != null && hardExitSec < noEntrySec) {
      problems.push('hard_exit_at must not be earlier than no_entry_from');
    }
    if (problems.length) {
      return { mode: 'error', cfg: null, problems: problems.map(function (p) { return 'strategy: ' + p; }) };
    }
    return { mode: 'active', cfg: {
      stopMultiple: sec.stop_multiple,
      targetMultiple: sec.target_multiple,
      cost: sec.round_trip_cost_points,
      noEntrySec: noEntrySec,        // seconds since midnight IST, or null = no limit
      hardExitSec: hardExitSec,
      noEntryLabel: sec.no_entry_from,
      hardExitLabel: sec.hard_exit_at,
    }, problems: [] };
  }

  /** "HH:MM" -> seconds since midnight; null stays null (rule off); anything else -> undefined (invalid). */
  function parseClock(v) {
    if (v === null) return null;
    if (typeof v !== 'string') return undefined;
    var m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : undefined;
  }

  /** Seconds since midnight IST for an epoch second. */
  function istSec(t) { return (((t + 19800) % 86400) + 86400) % 86400; }

  /** First index in the ascending array `a` whose value is >= x. */
  function lowerBound(a, x) {
    var lo = 0, hi = a.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (a[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /**
   * @param {Array} signals  full-signal marks: { time, pattern, eDistance, ... } (kind C1+C2+C3+C4+C5).
   * @param {{times:ArrayLike<number>, prices:ArrayLike<number>}} ticks  the session's ticks, ascending.
   * @param {Array<{time:number,open:number}>} candles  the LTF candles the signals were found on.
   * @param {number} ltfSec  LTF candle length in seconds.
   * @param {{stopMultiple:number,targetMultiple:number,cost:number}} cfg  normalizeStrategy().cfg
   * @returns {{trades:Array, skipped:Array}}
   */
  function simulateTrades(signals, ticks, candles, ltfSec, cfg) {
    var trades = [], skipped = [];
    if (!signals || !signals.length || !candles || !candles.length || !ticks) return { trades: trades, skipped: skipped };
    var times = ticks.times, prices = ticks.prices, n = times.length;
    var idx = new Map();
    candles.forEach(function (c, i) { idx.set(c.time, i); });
    var sigs = signals.slice().sort(function (a, b) { return a.time - b.time; });
    var lastExit = -Infinity;

    sigs.forEach(function (sig) {
      var i = idx.get(sig.time);
      if (i === undefined) { skipped.push({ time: sig.time, pattern: sig.pattern, reason: 'no-candle' }); return; }
      // the signal is knowable once the E candle has closed AND its HTF zone has closed (no look-ahead)
      var avail = Math.max(sig.time + ltfSec, sig.windowCloseTime || 0);
      var j = i + 1;
      while (j < candles.length && candles[j].time < avail) j++;
      var next = candles[j];
      if (!next) { skipped.push({ time: sig.time, pattern: sig.pattern, reason: 'no-next-candle' }); return; }
      var risk = sig.eDistance;
      if (!(risk > 0)) { skipped.push({ time: sig.time, pattern: sig.pattern, reason: 'no-risk' }); return; }
      if ((cfg.noEntrySec != null && istSec(next.time) >= cfg.noEntrySec) ||
          (cfg.hardExitSec != null && istSec(next.time) >= cfg.hardExitSec)) {      // no new entry once trading is closed
        skipped.push({ time: sig.time, pattern: sig.pattern, reason: 'after-cutoff' }); return;
      }
      if (next.time < lastExit) { skipped.push({ time: sig.time, pattern: sig.pattern, reason: 'in-trade' }); return; }

      var long = sig.pattern === 'A';
      var entry = next.open;
      var stop = long ? entry - cfg.stopMultiple * risk : entry + cfg.stopMultiple * risk;
      var target = long ? entry + cfg.targetMultiple * risk : entry - cfg.targetMultiple * risk;

      // replay: the opening tick of the entry candle IS the entry, so look at the ticks after it
      var k0 = lowerBound(times, next.time);
      var hasOpenTick = k0 < n && times[k0] < next.time + ltfSec;
      var k = k0 + (hasOpenTick ? 1 : 0);
      var hardEpoch = cfg.hardExitSec != null ? next.time - istSec(next.time) + cfg.hardExitSec : Infinity;
      var exitPrice = null, exitTime = null, reason = null;
      var mfe = 0, mae = 0;                                // best / worst excursion in points (mae <= 0)
      for (; k < n; k++) {
        if (times[k] >= hardEpoch) { exitPrice = prices[k]; exitTime = times[k]; reason = 'HARD'; break; }   // hard exit
        var p = prices[k];
        var fav = long ? p - entry : entry - p;
        if (fav > mfe) mfe = fav;
        if (fav < mae) mae = fav;
        if (long ? p <= stop : p >= stop) { exitPrice = stop; exitTime = times[k]; reason = 'STOP'; break; }
        if (long ? p >= target : p <= target) { exitPrice = target; exitTime = times[k]; reason = 'TARGET'; break; }
      }
      if (reason === null) {                               // end of the session
        if (n > 0 && times[n - 1] >= next.time) { exitPrice = prices[n - 1]; exitTime = times[n - 1]; }
        else { exitPrice = entry; exitTime = next.time; }
        reason = 'EOD';
      }
      var gross = long ? exitPrice - entry : entry - exitPrice;
      var pnl = gross - cfg.cost;
      trades.push({
        pattern: sig.pattern, side: long ? 'LONG' : 'SHORT',
        signalTime: sig.time, entryTime: next.time, entryPrice: entry, entryDelaySec: next.time - (sig.time + ltfSec),
        stop: stop, target: target, risk: risk,
        exitTime: exitTime, exitPrice: exitPrice, exitReason: reason,
        pnl: pnl, r: pnl / risk, durationSec: exitTime - next.time,
        mfe: mfe, mae: mae,
      });
      lastExit = exitTime;
    });
    return { trades: trades, skipped: skipped };
  }

  /** One group's statistics (no side split). */
  function stats(trades) {
    var n = trades.length;
    var out = {
      trades: n, wins: 0, losses: 0, flat: 0, winRate: null,
      targetHits: 0, stopHits: 0, hardExits: 0, eodExits: 0,
      totalPnl: 0, avgPnl: null, avgWin: null, avgLoss: null, avgR: null,
      grossProfit: 0, grossLoss: 0, profitFactor: null,
      best: null, worst: null, maxDrawdown: 0, maxConsecLosses: 0,
    };
    if (!n) return out;
    var sorted = trades.slice().sort(function (a, b) { return a.entryTime - b.entryTime; });
    var cum = 0, peak = 0, run = 0, sumR = 0;
    sorted.forEach(function (t) {
      if (t.pnl > 0) { out.wins++; out.grossProfit += t.pnl; run = 0; }
      else if (t.pnl < 0) { out.losses++; out.grossLoss += -t.pnl; run++; if (run > out.maxConsecLosses) out.maxConsecLosses = run; }
      else { out.flat++; run = 0; }
      if (t.exitReason === 'TARGET') out.targetHits++;
      else if (t.exitReason === 'STOP') out.stopHits++;
      else if (t.exitReason === 'HARD') out.hardExits++;
      else out.eodExits++;
      cum += t.pnl; sumR += t.r;
      if (cum > peak) peak = cum;
      if (peak - cum > out.maxDrawdown) out.maxDrawdown = peak - cum;
      if (out.best === null || t.pnl > out.best) out.best = t.pnl;
      if (out.worst === null || t.pnl < out.worst) out.worst = t.pnl;
    });
    out.totalPnl = cum;
    out.winRate = out.wins / n;
    out.avgPnl = cum / n;
    out.avgR = sumR / n;
    out.avgWin = out.wins ? out.grossProfit / out.wins : null;
    out.avgLoss = out.losses ? -out.grossLoss / out.losses : null;
    out.profitFactor = out.grossLoss > 0 ? out.grossProfit / out.grossLoss : (out.grossProfit > 0 ? Infinity : null);
    return out;
  }

  /** Overall statistics plus the LONG / SHORT split. */
  function summarize(trades) {
    var all = stats(trades);
    all.long = stats(trades.filter(function (t) { return t.side === 'LONG'; }));
    all.short = stats(trades.filter(function (t) { return t.side === 'SHORT'; }));
    return all;
  }

  return {
    normalizeStrategy: normalizeStrategy,
    simulateTrades: simulateTrades,
    summarize: summarize,
  };
}));
