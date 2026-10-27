/**
 * replay.js — helpers for the page's BAR REPLAY (pure, no DOM). Loaded by web/index.html (as window.TickReplay) and by the tests.
 *
 * Bar replay shows a session as if it were happening: only the ticks up to a replay time exist, the candles and every indicator are
 * rebuilt from them, so a decision on screen can never use a later price. The newest LTF candle is complete at every step; the newest
 * HTF candle is still forming (and the HTF rules treat it as not complete, so no HTF state appears before its close).
 *
 * Candles are bucketed from the session's first tick `t0`, so the k-th LTF candle (k = 1, 2, …) covers t0 + (k-1)·tf … t0 + k·tf − 1.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TickReplay = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** index of the last element of the ascending array `times` that is <= t, or -1 */
  function lastIndexAtOrBefore(times, t) {
    var lo = 0, hi = times.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid + 1; else hi = mid;
    }
    return lo - 1;
  }

  /** time of the last tick the k-th candle (k >= 1) of `tf` seconds covers, for a session whose first tick is at t0 */
  function closeTimeOfCandle(t0, tf, k) { return t0 + k * tf - 1; }

  /** how many candles of `tf` seconds are COMPLETE at `time` (the next one has not been fully covered yet) */
  function candleCountAt(t0, tf, time) { return Math.max(0, Math.floor((time - t0 + 1) / tf)); }

  /** the option-chain flow ({t, dce, dpe} arrays) cut to the snapshots stamped at or before `time`; null stays null */
  function cutFlow(flow, time) {
    if (!flow || !flow.t) return flow;
    var n = lastIndexAtOrBefore(flow.t, time) + 1;
    return { t: flow.t.slice(0, n), dce: flow.dce.slice(0, n), dpe: flow.dpe.slice(0, n) };
  }

  /**
   * The session as it looked at `time`: same shape as the page's tick object ({ times, prices, meta }), holding only the ticks at or
   * before `time`; meta.sessionEnd becomes the last tick shown (so a still-forming candle is never "complete") and the flow is cut too.
   * Returns null when no tick exists yet. `full` is not modified (the typed arrays are views, not copies).
   */
  function truncateTicks(full, time) {
    if (!full || !full.times || !full.times.length) return null;
    var n = lastIndexAtOrBefore(full.times, time) + 1;
    if (n <= 0) return null;
    var meta = {};
    for (var k in full.meta) if (Object.prototype.hasOwnProperty.call(full.meta, k)) meta[k] = full.meta[k];
    meta.flow = cutFlow(full.meta && full.meta.flow, full.times[n - 1]);
    meta.sessionEnd = full.times[n - 1];
    return { times: full.times.subarray ? full.times.subarray(0, n) : full.times.slice(0, n),
             prices: full.prices.subarray ? full.prices.subarray(0, n) : full.prices.slice(0, n), meta: meta };
  }

  return { lastIndexAtOrBefore: lastIndexAtOrBefore, closeTimeOfCandle: closeTimeOfCandle, candleCountAt: candleCountAt,
           cutFlow: cutFlow, truncateTicks: truncateTicks };
}));
