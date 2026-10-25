/**
 * confirmation.js — HTF candle-pattern matching (pure, no DOM, no chart library).
 *
 * This module is loaded both by web/index.html (as window.TickConfirm) and by
 * tests/confirmation.test.js (via require), so the exact code the browser
 * runs is the code the tests exercise.
 *
 * Terminology
 *   Pattern A  — the rule set formerly called "BUY"
 *   Pattern B  — the rule set formerly called "SELL"
 *   Matched / Not Matched / Unavailable  — the three states
 *
 * Timing model
 *   Coverage window — which LTF candles a state highlights: the five closing in
 *                     (C_k - htfSec, C_k]
 *   Reveal time     — when it becomes visible: C_k, and never before
 *
 * Nothing here reads the wall clock, so evaluation is deterministic and free of
 * look-ahead: a state depends only on candles that were already complete.
 *
 * Optional filters (config/htf.json -> normalizeFilter, normalizeSmaRsiFilter):
 * two independent three-mode gates ('off' | 'active' | 'error') applied inside
 * evaluate() only — evaluatePattern stays the literal five-candle transcription
 * of the Pattern A/B rules. The SMA-of-RSI gate (Part II) reuses the exact SMA
 * of Wilder RSI the HTF sub-panel plots, evaluated at the same candle index.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TickConfirm = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATE = {
    MATCHED: 'Matched',
    NOT_MATCHED: 'Not Matched',
    UNAVAILABLE: 'Unavailable',
  };

  /**
   * A candle anchored at `time` with length `htfSec` covers ticks [time, time + htfSec),
   * so its last covered tick is `time + htfSec - 1`. It is complete when that last tick
   * is not past the final tick available.
   *
   * The `- 1` is deliberate and was proven against buildCandles(): without it a bucket
   * that is fully covered is wrongly dropped whenever the session ends exactly one second
   * before a boundary. See CandleImplementionplan.md §5.1 and test T12.
   */
  function isComplete(candle, htfSec, availableUpTo) {
    return candle.time + htfSec - 1 <= availableUpTo;
  }

  /** Literal transcription of the rules. Strict comparisons throughout. */
  function evaluatePattern(c1, c2, c3, c4, c5) {
    var isRed = function (c) { return c.close < c.open; };
    var isGreen = function (c) { return c.close > c.open; };

    var c5aA = c2.high > c3.high && c2.high > c4.high && c2.high > c5.high;
    var c5bA = c3.high > c4.high && c3.high > c5.high;
    var c5aB = c2.high < c3.high && c2.high < c4.high && c2.high < c5.high;
    var c5bB = c3.high < c4.high && c3.high < c5.high;

    var conditions = {
      c1: c2.high > c1.high && c2.low > c1.low,
      c2: c2.high < c1.high && c2.low < c1.low,
      red2: isRed(c2), red1: isRed(c1),
      green2: isGreen(c2), green1: isGreen(c1),
      c5aA: c5aA, c5bA: c5bA, c5aB: c5aB, c5bB: c5bB,
    };

    var patternA = conditions.c1 && conditions.red2 && conditions.red1 && (c5aA || c5bA);
    var patternB = conditions.c2 && conditions.green2 && conditions.green1 && (c5aB || c5bB);

    return { patternA: patternA, patternB: patternB, conditions: conditions };
  }

  /* ------------- ATR-normalized SMA slope filter (config-driven, plan §3.4) ------------- */

  /**
   * Three-mode configuration contract:
   *   'off'    — section absent or enabled:false (deliberately disabled) => original
   *              behavior; sibling fields are inert and nothing is computed.
   *   'active' — validated section => the directional gate applies.
   *   'error'  — config present but invalid, or config.js never generated => fail
   *              closed: never matches, and the caller displays `problems`.
   */
  function normalizeFilter(raw) {
    if (raw == null) {
      return { mode: 'error', filter: null,
               problems: ['config not generated — run node scripts/build-config.js'] };
    }
    if (typeof raw !== 'object') {
      return { mode: 'error', filter: null, problems: ['config must be a JSON object'] };
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'sma_slope_filter')) {
      return { mode: 'off', filter: null, problems: [] };   // deliberately absent
    }
    var sec = raw.sma_slope_filter;
    if (sec == null || typeof sec !== 'object' || Array.isArray(sec)) {
      return { mode: 'error', filter: null, problems: ['sma_slope_filter must be an object'] };
    }
    if (sec.enabled === false) return { mode: 'off', filter: null, problems: [] };

    var problems = [];
    if (sec.enabled !== true) problems.push('enabled must be a boolean (true or false)');
    if (sec.method !== 'atr_normalized') problems.push('method must be "atr_normalized"');
    if (!Number.isInteger(sec.sma_period) || sec.sma_period < 2) {
      problems.push('sma_period must be an integer >= 2');
    }
    if (!Number.isInteger(sec.atr_period) || sec.atr_period < 2) {
      problems.push('atr_period must be an integer >= 2');
    }
    if (!Number.isInteger(sec.lookback_candles) || sec.lookback_candles < 1) {
      problems.push('lookback_candles must be an integer >= 1');
    }
    if (typeof sec.minimum_slope !== 'number' || !Number.isFinite(sec.minimum_slope) ||
        sec.minimum_slope < 0) {
      problems.push('minimum_slope must be a finite number >= 0');
    }
    if (problems.length) return { mode: 'error', filter: null, problems: problems };
    return { mode: 'active', filter: {
      smaPeriod: sec.sma_period,
      atrPeriod: sec.atr_period,
      lookback: sec.lookback_candles,
      minSlope: sec.minimum_slope,
    }, problems: [] };
  }

  /**
   * SMA-of-RSI filter configuration (Part II of htf_sma.md) — the same three-mode
   * contract as normalizeFilter, reading ONLY its own `sma_rsi_filter` section:
   * the two validators are independent in both directions (test T32). Field
   * problems are prefixed with the section name so the UI can always say which
   * section broke (approved P6).
   *
   *   period         SMA length applied to the RSI series (integer >= 2)
   *   pattern_a_max  Pattern A passes while SMA-of-RSI < this (strictly)
   *   pattern_b_min  Pattern B passes while SMA-of-RSI > this (strictly)
   */
  function normalizeSmaRsiFilter(raw) {
    if (raw == null) {
      return { mode: 'error', filter: null,
               problems: ['config not generated — run node scripts/build-config.js'] };
    }
    if (typeof raw !== 'object') {
      return { mode: 'error', filter: null, problems: ['config must be a JSON object'] };
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'sma_rsi_filter')) {
      return { mode: 'off', filter: null, problems: [] };   // deliberately absent
    }
    var sec = raw.sma_rsi_filter;
    if (sec == null || typeof sec !== 'object' || Array.isArray(sec)) {
      return { mode: 'error', filter: null, problems: ['sma_rsi_filter must be an object'] };
    }
    if (sec.enabled === false) return { mode: 'off', filter: null, problems: [] };

    var problems = [];
    if (sec.enabled !== true) {
      problems.push('sma_rsi_filter: enabled must be a boolean (true or false)');
    }
    if (!Number.isInteger(sec.period) || sec.period < 2) {
      problems.push('sma_rsi_filter: period must be an integer >= 2');
    }
    if (typeof sec.pattern_a_max !== 'number' || !Number.isFinite(sec.pattern_a_max) ||
        sec.pattern_a_max < 0 || sec.pattern_a_max > 100) {
      problems.push('sma_rsi_filter: pattern_a_max must be a finite number in [0, 100]');
    }
    if (typeof sec.pattern_b_min !== 'number' || !Number.isFinite(sec.pattern_b_min) ||
        sec.pattern_b_min < 0 || sec.pattern_b_min > 100) {
      problems.push('sma_rsi_filter: pattern_b_min must be a finite number in [0, 100]');
    }
    if (problems.length) return { mode: 'error', filter: null, problems: problems };
    return { mode: 'active', filter: {
      period: sec.period,
      patternAmax: sec.pattern_a_max,
      patternBmin: sec.pattern_b_min,
    }, problems: [] };
  }

  /**
   * Option-chain OI-change filter configuration (config/htf.json -> oi_change_filter) — the same three-mode contract as the
   * other two gates, reading ONLY its own section.
   *
   *   minimum_difference  how far the PE open-interest change must be ABOVE (Pattern A) or BELOW (Pattern B) the CE one,
   *                       in the file's own units (>= 0, default 0)
   *   Pattern A passes when  PE change - CE change  >  minimum_difference      (strict)
   *   Pattern B passes when  CE change - PE change  >  minimum_difference      (strict)
   *
   * "Change" is the CE / PE open-interest change of the candle being judged (candle -1): the file's change of its minute for a
   * 1m candle, the sum of the minutes inside it for a longer one (src/oi-flow.js). The per-candle values travel on
   * `normalized.perCandle` (set by the page / runner for the session on screen); without them the gate fails closed.
   */
  function normalizeOiFilter(raw) {
    if (raw == null) {
      return { mode: 'error', filter: null,
               problems: ['config not generated — run node scripts/build-config.js'] };
    }
    if (typeof raw !== 'object') {
      return { mode: 'error', filter: null, problems: ['config must be a JSON object'] };
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'oi_change_filter')) {
      return { mode: 'off', filter: null, problems: [] };   // deliberately absent
    }
    var sec = raw.oi_change_filter;
    if (sec == null || typeof sec !== 'object' || Array.isArray(sec)) {
      return { mode: 'error', filter: null, problems: ['oi_change_filter must be an object'] };
    }
    if (sec.enabled === false) return { mode: 'off', filter: null, problems: [] };

    var problems = [];
    if (sec.enabled !== true) problems.push('oi_change_filter: enabled must be a boolean (true or false)');
    var md = sec.minimum_difference === undefined ? 0 : sec.minimum_difference;
    if (typeof md !== 'number' || !Number.isFinite(md) || md < 0) {
      problems.push('oi_change_filter: minimum_difference must be a finite number >= 0');
    }
    if (problems.length) return { mode: 'error', filter: null, problems: problems };
    return { mode: 'active', filter: { minDiff: md }, problems: [] };
  }

  /** Simple moving average of closes; null until `period` finite values exist. */
  function smaArray(values, period) {
    var out = new Array(values.length).fill(null);
    for (var i = period - 1; i < values.length; i++) {
      var sum = 0, ok = true;
      for (var k = i - period + 1; k <= i; k++) {
        if (values[k] == null || !Number.isFinite(values[k])) { ok = false; break; }
        sum += values[k];
      }
      if (ok) out[i] = sum / period;
    }
    return out;
  }

  /**
   * True range at index i. Index 0 has no previous close, so the first valid TR is
   * at index 1 (plan §4.1 indexing table). Returns null when any operand is
   * non-finite or the candle range itself is malformed (high < low) — a null is
   * never turned into a number downstream.
   */
  function trueRange(candles, i) {
    if (i < 1) return null;
    var c = candles[i], pc = candles[i - 1].close;
    if (!c || !Number.isFinite(c.high) || !Number.isFinite(c.low) || c.high < c.low ||
        !Number.isFinite(pc)) return null;
    var tr = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    return Number.isFinite(tr) ? tr : null;
  }

  /**
   * Wilder ATR (approved Q4): null below `period`; seed = simple mean of the first
   * `period` valid true ranges (indices 1..period); Wilder recursion above. A broken
   * seed window nulls everything, and any later invalid TR nulls that value and all
   * after it — a null ATR never yields a valid slope.
   */
  function atrArray(candles, period) {
    var n = candles.length;
    var out = new Array(n).fill(null);
    if (n <= period) return out;
    var sum = 0;
    for (var j = 1; j <= period; j++) {
      var seedTr = trueRange(candles, j);
      if (seedTr === null) return out;
      sum += seedTr;
    }
    out[period] = sum / period;
    for (var i = period + 1; i < n; i++) {
      var tr = trueRange(candles, i);
      out[i] = (tr === null || out[i - 1] === null) ? null
             : (out[i - 1] * (period - 1) + tr) / period;
    }
    return out;
  }

  /**
   * slope[k] = (SMA[k] − SMA[k − lookback]) / ATR[k]; null until warm-up completes:
   * slopeMinIndex = max(smaPeriod − 1 + lookback, atrPeriod). Only indices ≤ k are
   * read, so an entry's slope can never depend on a later candle (no look-ahead),
   * and completeness of k implies completeness of every index used.
   */
  function slopeSeries(candles, f) {
    var n = candles.length;
    var closes = new Array(n);
    for (var i = 0; i < n; i++) closes[i] = candles[i].close;
    var sma = smaArray(closes, f.smaPeriod);
    var atr = atrArray(candles, f.atrPeriod);
    var out = new Array(n).fill(null);
    var minIdx = Math.max(f.smaPeriod - 1 + f.lookback, f.atrPeriod);
    for (var k = minIdx; k < n; k++) {
      var a = atr[k], s0 = sma[k], s1 = sma[k - f.lookback];
      if (a == null || s0 == null || s1 == null) continue;
      if (!(a > 0)) continue;                       // 0, negative or NaN ATR
      var v = (s0 - s1) / a;
      if (Number.isFinite(v)) out[k] = v;
    }
    return out;
  }

  /**
   * Wilder RSI as an array — a faithful mirror of the `rsi()` function that draws
   * the RSI sub-panel in index.html; test T34 proves the two agree element for
   * element on real data (nulls aligned). null below the warm-up index `period`;
   * a NaN close propagates to NaN here and becomes null via smaArray — a NaN RSI
   * can never pass a gate.
   */
  function rsiArray(closes, period) {
    var out = new Array(closes.length).fill(null);
    if (closes.length <= period) return out;

    var gain = 0, loss = 0;
    for (var i = 1; i <= period; i++) {
      var d = closes[i] - closes[i - 1];
      if (d > 0) gain += d; else loss -= d;
    }
    var ag = gain / period;
    var al = loss / period;
    var toRsi = function () { return al === 0 ? 100 : 100 - 100 / (1 + ag / al); };
    out[period] = toRsi();

    for (var j = period + 1; j < closes.length; j++) {
      var dj = closes[j] - closes[j - 1];
      ag = (ag * (period - 1) + (dj > 0 ? dj : 0)) / period;
      al = (al * (period - 1) + (dj < 0 ? -dj : 0)) / period;
      out[j] = toRsi();
    }
    return out;
  }

  /**
   * SMA(`period`) of the Wilder RSI(14) series — the same SMA 14 of RSI the HTF
   * sub-panel plots (rsiMa14 in index.html). RSI length is fixed at 14 (approved
   * Q-P1); `f.period` is the configurable SMA length. null until warm-up
   * completes: first non-null index = 13 + period (= 27 at period 14). Only
   * indices ≤ k are read, so no look-ahead — and a null never passes a gate.
   */
  function rsiSmaSeries(candles, f) {
    var n = candles.length;
    var closes = new Array(n);
    for (var i = 0; i < n; i++) closes[i] = candles[i].close;
    return smaArray(rsiArray(closes, 14), f.period);
  }

  /**
   * Evaluate an HTF candle series.
   *
   * @param {Array<{time:number,open:number,high:number,low:number,close:number}>} candles
   *        HTF candles from buildCandles(), ascending by time.
   * @param {Object} opts
   * @param {number} opts.htfSec        HTF bucket length in seconds.
   * @param {number} opts.sessionEndTick Last tick epoch of the session (getTicks().meta.sessionEnd).
   * @param {number} [opts.completedUpTo=sessionEndTick]
   *        Live cut-off. A candle whose last covered tick is past this is not yet
   *        complete and is never considered — this is what prevents look-ahead.
   * @param {Object} [opts.filter] normalizeFilter() result controlling the ATR-
   *        normalized SMA slope gate. It may carry an independent `rsi` member —
   *        the normalizeSmaRsiFilter() result gating on SMA(period) of RSI(14)
   *        (Part II). Absent sections => mode 'off': original behavior, and
   *        nothing extra is computed.
   * @returns {Map<number, Object>} keyed by closeTime (= candle.time + htfSec).
   *
   * Each entry: { state, pattern, conditions, candleTime, closeTime }.
   * Ineligible (incomplete) candles produce no entry at all.
   */
  function evaluate(candles, opts) {
    var htfSec = opts.htfSec;
    var sessionEndTick = opts.sessionEndTick;
    var availableUpTo = opts.completedUpTo == null ? sessionEndTick : opts.completedUpTo;
    var out = new Map();
    if (!candles || !candles.length) return out;

    // filter modes (plan §5.1, Part II): only 'active' computes anything.
    // opts.filter is the normalizeFilter() result and may carry an independent
    // `rsi` member (normalizeSmaRsiFilter()) — index.html attaches it to the same
    // object so both sections travel together through one cache key (T23 wiring).
    var norm = opts.filter || null;
    var mode = norm && norm.mode ? norm.mode : 'off';
    var rNorm = norm && norm.rsi ? norm.rsi : null;
    var rMode = rNorm && rNorm.mode ? rNorm.mode : 'off';
    var oNorm = norm && norm.oi ? norm.oi : null;
    var oMode = oNorm && oNorm.mode ? oNorm.mode : 'off';
    var anyError = mode === 'error' || rMode === 'error' || oMode === 'error';
    var f = mode === 'active' ? norm.filter : null;
    var rf = rMode === 'active' ? rNorm.filter : null;
    var slopes = mode === 'active' ? slopeSeries(candles, f) : null;
    var rsiSmas = rMode === 'active' ? rsiSmaSeries(candles, rf) : null;
    var of = oMode === 'active' ? oNorm.filter : null;
    var oiArr = oMode === 'active' && oNorm.perCandle ? oNorm.perCandle : null;   // per-candle { dce, dpe } | null

    for (var k = 0; k < candles.length; k++) {
      var c1 = candles[k];
      // never emit anything for a candle that is not yet complete
      if (!isComplete(c1, htfSec, Math.min(sessionEndTick, availableUpTo))) continue;

      var closeTime = c1.time + htfSec;
      var base = { candleTime: c1.time, closeTime: closeTime, c2Time: k >= 1 ? candles[k - 1].time : null };

      if (k < 4) {
        out.set(closeTime, Object.assign({}, base, {
          state: STATE.UNAVAILABLE,
          pattern: null,
          conditions: null,
          reason: 'insufficient-history',
        }));
        continue;
      }

      var c2 = candles[k - 1], c3 = candles[k - 2], c4 = candles[k - 3], c5 = candles[k - 4];
      // if any candle behind the window is itself incomplete, the state is not knowable
      var ok = [c2, c3, c4, c5].every(function (c) {
        return isComplete(c, htfSec, Math.min(sessionEndTick, availableUpTo));
      });
      if (!ok) {
        out.set(closeTime, Object.assign({}, base, {
          state: STATE.UNAVAILABLE,
          pattern: null,
          conditions: null,
          reason: 'incomplete-history',
        }));
        continue;
      }

      var r = evaluatePattern(c1, c2, c3, c4, c5);

      if (anyError) {
        // fail closed (approved Q3 / Part II Q-P3): evaluable window, broken config,
        // never matches. Unreachable for k < 4 — window-history Unavailable keeps
        // precedence (Q2/E7). Condition keys appear only for sections whose mode
        // isn't 'off' (P3).
        var econd = Object.assign({}, r.conditions);
        if (mode !== 'off') Object.assign(econd, { slope: null, slopeA: null, slopeB: null });
        if (rMode !== 'off') Object.assign(econd, { rsi: null, rsiA: null, rsiB: null });
        if (oMode !== 'off') Object.assign(econd, { oiCe: null, oiPe: null, oiA: null, oiB: null });
        out.set(closeTime, Object.assign({}, base, {
          state: STATE.NOT_MATCHED,
          pattern: null,
          conditions: econd,
          reason: 'config-error',
        }));
        continue;
      }

      if (mode === 'active' || rMode === 'active' || oMode === 'active') {
        // per-section condition keys in a fixed order (slope first), so output with
        // the rsi section off is byte-identical to Part I (T19/T25/T31 regression)
        var cond = Object.assign({}, r.conditions);
        if (mode === 'active') {
          var s = slopes[k];                             // number | null
          cond.slope = s;
          cond.slopeA = s === null ? null : s > f.minSlope;  // strict (approved spec)
          cond.slopeB = s === null ? null : s < -f.minSlope;  // strict
        }
        if (rMode === 'active') {
          var rv = rsiSmas[k];                           // number | null (warm-up 13 + period)
          cond.rsi = rv;
          cond.rsiA = rv === null ? null : rv < rf.patternAmax;  // strict (approved Q-P1)
          cond.rsiB = rv === null ? null : rv > rf.patternBmin;  // strict
        }
        if (oMode === 'active') {
          var oc = oiArr ? oiArr[k] : null;                 // { dce, dpe } | null (no flow for this candle)
          cond.oiCe = oc ? oc.dce : null;
          cond.oiPe = oc ? oc.dpe : null;
          cond.oiA = oc ? (oc.dpe - oc.dce) > of.minDiff : null;   // strict; PE change above CE change
          cond.oiB = oc ? (oc.dce - oc.dpe) > of.minDiff : null;   // strict; CE change above PE change
        }
        // sequential gates: a pattern survives only its OWN chain (A: slopeA ∧ rsiA ∧ oiA,
        // B: slopeB ∧ rsiB ∧ oiB), and each link applies only while its section is active.
        // An unavailable indicator value is not `true`, so it fails closed (Q-P2).
        var basePattern = r.patternA ? 'A' : (r.patternB ? 'B' : null);
        var pat = basePattern;
        if (pat === 'A' && mode === 'active' && cond.slopeA !== true) pat = null;
        if (pat === 'B' && mode === 'active' && cond.slopeB !== true) pat = null;
        if (pat === 'A' && rMode === 'active' && cond.rsiA !== true) pat = null;
        if (pat === 'B' && rMode === 'active' && cond.rsiB !== true) pat = null;
        if (pat === 'A' && oMode === 'active' && cond.oiA !== true) pat = null;
        if (pat === 'B' && oMode === 'active' && cond.oiB !== true) pat = null;
        out.set(closeTime, Object.assign({}, base, {
          state: pat ? STATE.MATCHED : STATE.NOT_MATCHED,
          pattern: pat,
          conditions: cond,
        }));
        continue;
      }

      // both filters 'off' — the original path, byte-identical output (no extra keys)
      out.set(closeTime, Object.assign({}, base, {
        state: r.patternA || r.patternB ? STATE.MATCHED : STATE.NOT_MATCHED,
        pattern: r.patternA ? 'A' : (r.patternB ? 'B' : null),
        conditions: r.conditions,
      }));
    }
    return out;
  }

  /**
   * Map HTF states onto LTF candles: each LTF candle is highlighted by the state whose
   * coverage window `(C_k - htfSec, C_k]` contains its close time.
   *
   * @param {Array} ltfCandles  LTF candles from buildCandles(), ascending.
   * @param {Map<number,Object>} states  Result of evaluate().
   * @param {Object} opts  { htfSec, ltfSec }
   * @returns {Map<number, Object>} keyed by LTF candle time.
   */
  function mapToLtf(ltfCandles, states, opts) {
    var htfSec = opts.htfSec, ltfSec = opts.ltfSec;
    var out = new Map();
    if (!ltfCandles || !ltfCandles.length || !states || !states.size) return out;

    var sorted = Array.from(states.keys()).sort(function (a, b) { return a - b; });
    var i = 0;
    for (var n = 0; n < ltfCandles.length; n++) {
      var lc = ltfCandles[n];
      var close = lc.time + ltfSec;
      // advance to the first state whose closeTime is >= this LTF close
      while (i < sorted.length && sorted[i] < close) i++;
      if (i >= sorted.length) continue;
      var C = sorted[i];
      if (close > C - htfSec && close <= C) out.set(lc.time, states.get(C));
    }
    return out;
  }

  /** Latest entry whose closeTime <= `now` — the single source for the toolbar badge. */
  function latest(states, now) {
    var best = null;
    states.forEach(function (v) {
      if (v.closeTime <= now && (best === null || v.closeTime > best.closeTime)) best = v;
    });
    return best;
  }

  return {
    STATE: STATE,
    isComplete: isComplete,
    rsiArray: rsiArray,
    evaluatePattern: evaluatePattern,
    evaluate: evaluate,
    mapToLtf: mapToLtf,
    latest: latest,
    normalizeFilter: normalizeFilter,
    normalizeSmaRsiFilter: normalizeSmaRsiFilter,
    normalizeOiFilter: normalizeOiFilter,
  };
}));
