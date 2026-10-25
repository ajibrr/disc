/**
 * ltf-conditions.js — LTF chart conditions (pure, no DOM, no chart library).
 *
 * Loaded by web/index.html (as window.TickLtf) and by tests/ltf-condition1.test.js
 * (via require), so the exact code the browser runs is the code the tests exercise.
 * One evaluateConditionN() per condition; see ltf.md.
 *
 * Condition 1 — RSI 50 Cross (Continuation)
 *   After a highlighted Pattern A / B band, mark the first LTF candle whose RSI 14
 *   crosses `level` in the pattern's direction (strict comparisons):
 *     A: previous RSI < level and current RSI > level
 *     B: previous RSI > level and current RSI < level
 *   The span is counted from the band's first candle: only positions scan_min_candles..scan_max_candles count (1 = the first candle)
 *   (0 = unlimited) and stops where a newer band begins. EVERY crossing inside that
 *   span is marked, including crossings on the band's own candles (a band can yield
 *   several marks). A mark on candle i reads only RSI at i and i-1, both already
 *   closed.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TickLtf = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Three-mode configuration contract (same as the HTF filters):
   *   'off'    — section absent or enabled:false => nothing is evaluated
   *   'active' — validated section
   *   'error'  — config present but invalid, or never generated => fail closed:
   *              no marks, and the caller displays `problems`
   */
  function normalizeCondition1(raw) {
    if (raw == null) {
      return { mode: 'error', cfg: null,
               problems: ['config not generated — run node scripts/build-config.js'] };
    }
    if (typeof raw !== 'object') {
      return { mode: 'error', cfg: null, problems: ['config must be a JSON object'] };
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'condition_1_rsi_cross')) {
      return { mode: 'off', cfg: null, problems: [] };
    }
    var sec = raw.condition_1_rsi_cross;
    if (sec == null || typeof sec !== 'object' || Array.isArray(sec)) {
      return { mode: 'error', cfg: null, problems: ['condition_1_rsi_cross must be an object'] };
    }
    if (sec.enabled === false) return { mode: 'off', cfg: null, problems: [] };

    var problems = [];
    if (sec.enabled !== true) problems.push('enabled must be a boolean (true or false)');
    if (!Number.isInteger(sec.rsi_period) || sec.rsi_period < 1) {
      problems.push('rsi_period must be an integer >= 1');
    }
    if (typeof sec.level !== 'number' || !Number.isFinite(sec.level) || sec.level < 0 || sec.level > 100) {
      problems.push('level must be a number between 0 and 100');
    }
    // scan range: the crossing candle's position counted from the zone's first candle (1 = that candle) must lie in
    // [scan_min_candles, scan_max_candles]. The older single key `scan_candles` is still read as the maximum.
    var maxKey = sec.scan_max_candles !== undefined ? 'scan_max_candles' : 'scan_candles';
    var scanMax = sec[maxKey], scanMin = sec.scan_min_candles === undefined ? 1 : sec.scan_min_candles;
    if (!Number.isInteger(scanMax) || scanMax < 0) {
      problems.push(maxKey + ' must be an integer >= 0 (0 = no limit)');
    }
    if (!Number.isInteger(scanMin) || scanMin < 1) {
      problems.push('scan_min_candles must be an integer >= 1');
    }
    if (problems.length === 0 && scanMax > 0 && scanMin > scanMax) {
      problems.push('scan_min_candles must not be larger than ' + maxKey);
    }
    if (problems.length) {
      return { mode: 'error', cfg: null,
               problems: problems.map(function (p) { return 'condition_1_rsi_cross: ' + p; }) };
    }
    return { mode: 'active', cfg: {
      rsiPeriod: sec.rsi_period,
      level: sec.level,
      scanMin: scanMin,
      scanMax: scanMax,
      scanCandles: scanMax,                 // legacy name of the maximum
    }, problems: [] };
  }

  /**
   * @param {Array<{time:number}>} ltfCandles  LTF candles, ascending.
   * @param {Array<number|null>} rsiValues     RSI per candle (same length), null while warming up.
   * @param {Array<{from:number,to:number,pattern:string}>} windows  Matched bands
   *        (`from` = first candle time of the band, `to` = HTF close time), any order.
   * @param {{level:number, scanMin?:number, scanMax?:number, scanCandles?:number}} cfg  normalizeCondition1().cfg
   *        (scanMax, or the older scanCandles, = last position scanned, 0 = unlimited; scanMin = first position, default 1)
   * @returns {Array<{time:number,pattern:string,rsi:number,prevRsi:number,windowCloseTime:number}>}
   *          ascending by time.
   */
  function evaluateCondition1(ltfCandles, rsiValues, windows, cfg) {
    var out = [];
    if (!ltfCandles || !ltfCandles.length || !windows || !windows.length) return out;
    var n = ltfCandles.length;
    var ws = windows.slice().sort(function (a, b) { return a.from - b.from; });

    for (var k = 0; k < ws.length; k++) {
      var w = ws[k];
      var start = -1;
      for (var i = 0; i < n; i++) {
        if (ltfCandles[i].time >= w.from) { start = i; break; }
      }
      if (start < 0) continue;

      var scanMax = cfg.scanMax != null ? cfg.scanMax : cfg.scanCandles;     // position 1 = the band's first candle
      var scanMin = cfg.scanMin != null ? cfg.scanMin : 1;
      var end = n - 1;                                    // inclusive
      if (scanMax > 0) end = Math.min(end, start + scanMax - 1);
      if (k + 1 < ws.length) {                            // a newer band supersedes this one
        var nextFrom = ws[k + 1].from;
        while (end >= start && ltfCandles[end].time >= nextFrom) end--;
      }

      for (var j = Math.max(start + scanMin - 1, 1); j <= end; j++) {
        var prev = rsiValues[j - 1], cur = rsiValues[j];
        if (typeof prev !== 'number' || typeof cur !== 'number' ||
            !Number.isFinite(prev) || !Number.isFinite(cur)) continue;
        var hit = w.pattern === 'A' ? (prev < cfg.level && cur > cfg.level)
                                    : (prev > cfg.level && cur < cfg.level);
        if (hit) {
          out.push({ time: ltfCandles[j].time, pattern: w.pattern, rsi: cur, prevRsi: prev,
                     windowCloseTime: w.to });
        }
      }
    }
    return out.sort(function (a, b) { return a.time - b.time; });
  }

  /* ------------------------------------------------------------------ */
  /**
   * Condition 2 — SMA trend filter on Condition 1 (ltf.md)
   *   Keeps a Condition 1 mark only when, on that very candle:
   *     C2 A (Pattern A mark): SMA fast  >  SMA slow   (strict)
   *     C2 B (Pattern B mark): SMA fast  <  SMA slow   (strict)
   *   SMAs are simple averages of LTF closes; null until `period` candles exist, and a
   *   null never passes. Reads only closes at or before the mark's candle.
   */
  function normalizeCondition2(raw) {
    if (raw == null) {
      return { mode: 'error', cfg: null,
               problems: ['config not generated — run node scripts/build-config.js'] };
    }
    if (typeof raw !== 'object') {
      return { mode: 'error', cfg: null, problems: ['config must be a JSON object'] };
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'condition_2_sma_trend')) {
      return { mode: 'off', cfg: null, problems: [] };
    }
    var sec = raw.condition_2_sma_trend;
    if (sec == null || typeof sec !== 'object' || Array.isArray(sec)) {
      return { mode: 'error', cfg: null, problems: ['condition_2_sma_trend must be an object'] };
    }
    if (sec.enabled === false) return { mode: 'off', cfg: null, problems: [] };

    var problems = [];
    if (sec.enabled !== true) problems.push('enabled must be a boolean (true or false)');
    if (!Number.isInteger(sec.fast_period) || sec.fast_period < 1) {
      problems.push('fast_period must be an integer >= 1');
    }
    if (!Number.isInteger(sec.slow_period) || sec.slow_period < 1) {
      problems.push('slow_period must be an integer >= 1');
    }
    if (problems.length === 0 && sec.fast_period >= sec.slow_period) {
      problems.push('fast_period must be smaller than slow_period');
    }
    if (problems.length) {
      return { mode: 'error', cfg: null,
               problems: problems.map(function (p) { return 'condition_2_sma_trend: ' + p; }) };
    }
    return { mode: 'active', cfg: { fastPeriod: sec.fast_period, slowPeriod: sec.slow_period },
             problems: [] };
  }

  /** Simple moving average of `values`; null until `period` values exist. */
  function smaArray(values, period) {
    var out = new Array(values.length).fill(null);
    var sum = 0;
    for (var i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  /**
   * @param {Array<{time:number,close:number}>} ltfCandles  LTF candles, ascending.
   * @param {Array} c1Marks  evaluateCondition1() result.
   * @param {{fastPeriod:number, slowPeriod:number}} cfg  normalizeCondition2().cfg
   * @returns {Array} the C1 marks that pass, each extended with { smaFast, smaSlow }.
   */
  function evaluateCondition2(ltfCandles, c1Marks, cfg) {
    var out = [];
    if (!ltfCandles || !ltfCandles.length || !c1Marks || !c1Marks.length) return out;
    var closes = ltfCandles.map(function (c) { return c.close; });
    var fast = smaArray(closes, cfg.fastPeriod);
    var slow = smaArray(closes, cfg.slowPeriod);
    var idx = new Map();
    ltfCandles.forEach(function (c, i) { idx.set(c.time, i); });
    c1Marks.forEach(function (m) {
      var i = idx.get(m.time);
      if (i === undefined) return;
      var f = fast[i], s = slow[i];
      if (f === null || s === null) return;
      var pass = m.pattern === 'A' ? f > s : f < s;
      if (pass) out.push(Object.assign({}, m, { smaFast: f, smaSlow: s }));
    });
    return out;
  }

  /**
   * SMA spread — an INDICATOR for viewing, not a condition (ltf.md, "SMA spread view").
   *   spread % = (SMA fast - SMA slow) / SMA slow * 100      (signed)
   * positive = fast above slow, negative = fast below. null wherever either average is
   * not yet defined (SMA slow needs `period` candles) or the slow average is 0.
   * Inputs are the same arrays the chart plots, so the number always matches the lines.
   */
  function spreadPct(fast, slow) {
    return fast.map(function (f, i) {
      var s = slow[i];
      if (typeof f !== 'number' || typeof s !== 'number' || !Number.isFinite(f) ||
          !Number.isFinite(s) || s === 0) return null;
      return (f - s) / s * 100;
    });
  }

  /**
   * Condition 3 — SMA spread band on C1 + C2 (ltf.md)
   *   Keeps a C2 mark only when the SMA fast/slow spread % on that candle (the number the
   *   spread histogram shows) lies in a band next to zero:
   *     Pattern A: min_pct <  spread <= max_pct
   *     Pattern B: -max_pct <= spread <  -min_pct
   *   The lower edge is exclusive (C2 already needs the right sign), the upper edge is
   *   inclusive. The SMA periods are Condition 2's, so C3 tests the very averages C2 and
   *   the histogram use. A missing SMA value never passes.
   */
  function normalizeCondition3(raw) {
    if (raw == null) {
      return { mode: 'error', cfg: null,
               problems: ['config not generated — run node scripts/build-config.js'] };
    }
    if (typeof raw !== 'object') {
      return { mode: 'error', cfg: null, problems: ['config must be a JSON object'] };
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'condition_3_spread_band')) {
      return { mode: 'off', cfg: null, problems: [] };
    }
    var sec = raw.condition_3_spread_band;
    if (sec == null || typeof sec !== 'object' || Array.isArray(sec)) {
      return { mode: 'error', cfg: null, problems: ['condition_3_spread_band must be an object'] };
    }
    if (sec.enabled === false) return { mode: 'off', cfg: null, problems: [] };

    var problems = [];
    var num = function (v) { return typeof v === 'number' && Number.isFinite(v); };
    if (sec.enabled !== true) problems.push('enabled must be a boolean (true or false)');
    if (!num(sec.min_pct) || sec.min_pct < 0) problems.push('min_pct must be a finite number >= 0');
    if (!num(sec.max_pct) || sec.max_pct <= 0) problems.push('max_pct must be a finite number > 0');
    if (problems.length === 0 && sec.max_pct <= sec.min_pct) {
      problems.push('max_pct must be greater than min_pct');
    }
    if (problems.length) {
      return { mode: 'error', cfg: null,
               problems: problems.map(function (p) { return 'condition_3_spread_band: ' + p; }) };
    }
    return { mode: 'active', cfg: { minPct: sec.min_pct, maxPct: sec.max_pct }, problems: [] };
  }

  /**
   * @param {Array<{time:number,close:number}>} ltfCandles  LTF candles, ascending.
   * @param {Array} c2Marks  evaluateCondition2() result.
   * @param {{minPct:number, maxPct:number}} cfg   normalizeCondition3().cfg
   * @param {{fastPeriod:number, slowPeriod:number}} c2cfg  normalizeCondition2().cfg
   * @returns {Array} the C2 marks inside the band, each extended with { spreadPct }.
   */
  function evaluateCondition3(ltfCandles, c2Marks, cfg, c2cfg) {
    var out = [];
    if (!ltfCandles || !ltfCandles.length || !c2Marks || !c2Marks.length) return out;
    var closes = ltfCandles.map(function (c) { return c.close; });
    var sp = spreadPct(smaArray(closes, c2cfg.fastPeriod), smaArray(closes, c2cfg.slowPeriod));
    var idx = new Map();
    ltfCandles.forEach(function (c, i) { idx.set(c.time, i); });
    c2Marks.forEach(function (m) {
      var i = idx.get(m.time);
      if (i === undefined || sp[i] === null) return;
      var v = sp[i];
      var pass = m.pattern === 'A' ? (v > cfg.minPct && v <= cfg.maxPct)
                                   : (v < -cfg.minPct && v >= -cfg.maxPct);
      if (pass) out.push(Object.assign({}, m, { spreadPct: v }));
    });
    return out;
  }

  /**
   * Condition 4 — SMA-of-RSI extreme in the previous `lookback` candles, on C1+C2+C3 (ltf.md)
   *   Keeps a C3 mark only when ANY ONE of the `lookback` LTF candles immediately BEFORE the
   *   marked candle (the marked candle itself excluded; zone candles included) has the
   *   SMA(sma_period) of RSI(rsi_period) at an extreme:
   *     Pattern A: pattern_a_min <  SMA-of-RSI <= pattern_a_max     (shipped 67.5 .. 100)
   *     Pattern B: pattern_b_min <= SMA-of-RSI <  pattern_b_max     (shipped 0 .. 32.5)
   *   Strict comparisons. Candles where the indicator is not defined yet are skipped; with
   *   nothing usable the mark fails. Reads only candles before the marked one.
   */
  function normalizeCondition4(raw) {
    if (raw == null) {
      return { mode: 'error', cfg: null,
               problems: ['config not generated — run node scripts/build-config.js'] };
    }
    if (typeof raw !== 'object') {
      return { mode: 'error', cfg: null, problems: ['config must be a JSON object'] };
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'condition_4_rsi_sma_extreme')) {
      return { mode: 'off', cfg: null, problems: [] };
    }
    var sec = raw.condition_4_rsi_sma_extreme;
    if (sec == null || typeof sec !== 'object' || Array.isArray(sec)) {
      return { mode: 'error', cfg: null, problems: ['condition_4_rsi_sma_extreme must be an object'] };
    }
    if (sec.enabled === false) return { mode: 'off', cfg: null, problems: [] };

    var problems = [];
    var intGe1 = function (v) { return Number.isInteger(v) && v >= 1; };
    var pct = function (v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100; };
    if (sec.enabled !== true) problems.push('enabled must be a boolean (true or false)');
    if (!intGe1(sec.rsi_period)) problems.push('rsi_period must be an integer >= 1');
    if (!intGe1(sec.sma_period)) problems.push('sma_period must be an integer >= 1');
    // look-back window: the candles `lookback_min_candles` .. `lookback_max_candles` before the marked candle (1 = the one just
    // before it). The older single key `lookback_candles` is still read as the maximum.
    var lbMaxKey = sec.lookback_max_candles !== undefined ? 'lookback_max_candles' : 'lookback_candles';
    var lbMax = sec[lbMaxKey], lbMin = sec.lookback_min_candles === undefined ? 1 : sec.lookback_min_candles;
    if (!intGe1(lbMax)) problems.push(lbMaxKey + ' must be an integer >= 1');
    if (!intGe1(lbMin)) problems.push('lookback_min_candles must be an integer >= 1');
    if (problems.length === 0 && lbMin > lbMax) problems.push('lookback_min_candles must not be larger than ' + lbMaxKey);
    // value bands: Pattern A needs  a_min < SMA-of-RSI <= a_max ;  Pattern B needs  b_min <= SMA-of-RSI < b_max
    // (the older keys pattern_a_above / pattern_b_below are the A minimum / B maximum; the other edge defaults to 100 / 0)
    var aMinKey = sec.pattern_a_min !== undefined ? 'pattern_a_min' : 'pattern_a_above';
    var bMaxKey = sec.pattern_b_max !== undefined ? 'pattern_b_max' : 'pattern_b_below';
    var aMin = sec[aMinKey], aMax = sec.pattern_a_max === undefined ? 100 : sec.pattern_a_max;
    var bMax = sec[bMaxKey], bMin = sec.pattern_b_min === undefined ? 0 : sec.pattern_b_min;
    if (!pct(aMin)) problems.push(aMinKey + ' must be a number between 0 and 100');
    if (!pct(aMax)) problems.push('pattern_a_max must be a number between 0 and 100');
    if (!pct(bMax)) problems.push(bMaxKey + ' must be a number between 0 and 100');
    if (!pct(bMin)) problems.push('pattern_b_min must be a number between 0 and 100');
    if (problems.length === 0 && !(aMax > aMin)) problems.push('pattern_a_max must be greater than ' + aMinKey);
    if (problems.length === 0 && !(bMax > bMin)) problems.push(bMaxKey + ' must be greater than pattern_b_min');
    if (problems.length === 0 && !(bMax < aMin)) {
      problems.push(bMaxKey + ' must be smaller than ' + aMinKey);
    }
    if (problems.length) {
      return { mode: 'error', cfg: null,
               problems: problems.map(function (p) { return 'condition_4_rsi_sma_extreme: ' + p; }) };
    }
    return { mode: 'active', cfg: {
      rsiPeriod: sec.rsi_period,
      smaPeriod: sec.sma_period,
      lookbackMin: lbMin,
      lookbackMax: lbMax,
      aMin: aMin, aMax: aMax,
      bMin: bMin, bMax: bMax,
      lookback: lbMax,                      // legacy names (= the maximum / A minimum / B maximum)
      aAbove: aMin,
      bBelow: bMax,
    }, problems: [] };
  }

  /** SMA that is null until `period` NON-null values exist — mirrors the page's smaNullable. */
  function smaNullableArray(values, period) {
    var out = new Array(values.length).fill(null);
    for (var i = period - 1; i < values.length; i++) {
      var sum = 0, okAll = true;
      for (var k = i - period + 1; k <= i; k++) {
        if (values[k] === null || values[k] === undefined) { okAll = false; break; }
        sum += values[k];
      }
      if (okAll) out[i] = sum / period;
    }
    return out;
  }

  /**
   * @param {Array<{time:number}>} ltfCandles  LTF candles, ascending.
   * @param {Array} c3Marks  evaluateCondition3() result.
   * @param {Array<number|null>} rsiSma  SMA(sma_period) of RSI(rsi_period) per candle (null while warming up).
   * @param {{lookbackMin?:number,lookbackMax?:number,aMin?:number,aMax?:number,bMin?:number,bMax?:number,lookback?:number,aAbove?:number,bBelow?:number}} cfg
   *        normalizeCondition4().cfg (the older lookback / aAbove / bBelow mean lookbackMax / aMin / bMax, with the other edges open)
   * @returns {Array} the C3 marks that pass, each extended with { hitTime, hitValue } — the most
   *          recent qualifying candle inside the look-back.
   */
  function evaluateCondition4(ltfCandles, c3Marks, rsiSma, cfg) {
    var out = [];
    if (!ltfCandles || !ltfCandles.length || !c3Marks || !c3Marks.length) return out;
    var idx = new Map();
    ltfCandles.forEach(function (c, i) { idx.set(c.time, i); });
    c3Marks.forEach(function (m) {
      var i = idx.get(m.time);
      if (i === undefined) return;
      var lbMax = cfg.lookbackMax != null ? cfg.lookbackMax : cfg.lookback, lbMin = cfg.lookbackMin != null ? cfg.lookbackMin : 1;
      var aMin = cfg.aMin != null ? cfg.aMin : cfg.aAbove, aMax = cfg.aMax != null ? cfg.aMax : Infinity;
      var bMax = cfg.bMax != null ? cfg.bMax : cfg.bBelow, bMin = cfg.bMin != null ? cfg.bMin : -Infinity;
      var from = Math.max(0, i - lbMax);
      for (var j = i - lbMin; j >= from; j--) {           // most recent first; marked candle excluded
        var v = rsiSma[j];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        var hit = m.pattern === 'A' ? (v > aMin && v <= aMax) : (v < bMax && v >= bMin);
        if (hit) {
          out.push(Object.assign({}, m, { hitTime: ltfCandles[j].time, hitValue: v }));
          break;
        }
      }
    });
    return out;
  }

  /**
   * Condition 5 — back candle distance vs E candle distance, Patterns A and B (ltf_condition5_distance_ratio.md)
   *   E candle   = the candle carrying the C1+C2+C3+C4 A arrow
   *   E candle distance           = E.high - (E-1).low           (E-1 = the candle just before E)
   *   back high                   = max(high) of the `back_candles` candles BEFORE E (E excluded,
   *                                 E-1 included)
   *   Pattern A back candle distance = back high - E.high
   *   Keeps the E candle only when   back distance  >  distance_multiplier x E distance   (strict)
   *   An E distance <= 0 (E.high at or below the E-1 low) fails; so does a back distance <= 0.
   *   Pattern B is the exact mirror (the E candle carries the C1+C2+C3+C4 B arrow):
   *     e candle distance = (E-1).high - E.low,   back low = min(low) of the same N candles,
   *     back candle distance = E.low - back low,  keep when  back distance > multiplier x e distance.
   *   Reads only candles at or before E, so no look-ahead.
   */
  function normalizeCondition5(raw) {
    if (raw == null) {
      return { mode: 'error', cfg: null,
               problems: ['config not generated — run node scripts/build-config.js'] };
    }
    if (typeof raw !== 'object') {
      return { mode: 'error', cfg: null, problems: ['config must be a JSON object'] };
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'condition_5_distance_ratio')) {
      return { mode: 'off', cfg: null, problems: [] };
    }
    var sec = raw.condition_5_distance_ratio;
    if (sec == null || typeof sec !== 'object' || Array.isArray(sec)) {
      return { mode: 'error', cfg: null, problems: ['condition_5_distance_ratio must be an object'] };
    }
    if (sec.enabled === false) return { mode: 'off', cfg: null, problems: [] };

    var problems = [];
    if (sec.enabled !== true) problems.push('enabled must be a boolean (true or false)');
    if (!Number.isInteger(sec.back_candles) || sec.back_candles < 1) {
      problems.push('back_candles must be an integer >= 1');
    }
    if (typeof sec.distance_multiplier !== 'number' || !Number.isFinite(sec.distance_multiplier) ||
        sec.distance_multiplier <= 0) {
      problems.push('distance_multiplier must be a finite number > 0');
    }
    if (problems.length) {
      return { mode: 'error', cfg: null,
               problems: problems.map(function (p) { return 'condition_5_distance_ratio: ' + p; }) };
    }
    return { mode: 'active', cfg: { backCandles: sec.back_candles, multiplier: sec.distance_multiplier },
             problems: [] };
  }

  /**
   * @param {Array<{time:number,high:number,low:number}>} ltfCandles  LTF candles, ascending.
   * @param {Array} c4Marks  evaluateCondition4() result.
   * @param {{backCandles:number, multiplier:number}} cfg  normalizeCondition5().cfg
   * @returns {Array} the C4 marks that pass, each extended with { eDistance, backDistance, multiplier }
   *   plus { backHigh, backHighTime } (Pattern A) or { backLow, backLowTime } (Pattern B).
   */
  function evaluateCondition5(ltfCandles, c4Marks, cfg) {
    var out = [];
    if (!ltfCandles || !ltfCandles.length || !c4Marks || !c4Marks.length) return out;
    var idx = new Map();
    ltfCandles.forEach(function (c, i) { idx.set(c.time, i); });
    c4Marks.forEach(function (m) {
      var i = idx.get(m.time);
      if (i === undefined || i < 1) return;                // needs an E-1 candle
      var E = ltfCandles[i], P = ltfCandles[i - 1];
      var isA = m.pattern === 'A';
      var eDist = isA ? E.high - P.low : P.high - E.low;
      if (!(eDist > 0)) return;                            // non-positive E distance fails
      var from = Math.max(0, i - cfg.backCandles);
      var best = isA ? -Infinity : Infinity, bestTime = null;
      for (var j = from; j < i; j++) {                     // E excluded, E-1 included
        var v = isA ? ltfCandles[j].high : ltfCandles[j].low;
        if (isA ? v > best : v < best) { best = v; bestTime = ltfCandles[j].time; }
      }
      var backDist = isA ? best - E.high : E.low - best;
      if (!Number.isFinite(backDist)) return;
      if (backDist > cfg.multiplier * eDist) {
        var extra = { eDistance: eDist, backDistance: backDist, multiplier: cfg.multiplier };
        if (isA) { extra.backHigh = best; extra.backHighTime = bestTime; }
        else { extra.backLow = best; extra.backLowTime = bestTime; }
        out.push(Object.assign({}, m, extra));
      }
    });
    return out;
  }

  /**
   * Condition 6 — risk range, on C1 + C2 + C3 + C4 + C5 (both patterns)
   *   The risk of a trade is the E candle distance (the stop is `stop_multiple` x that distance). Keeps a C5 mark only when
   *     min_risk_points  <=  eDistance  <  max_risk_points       (points; the same range for long and short)
   *   The lower edge is inclusive, the upper edge exclusive. A mark without a usable eDistance never passes.
   *   Reads only the mark itself, so no look-ahead.
   */
  function normalizeCondition6(raw) {
    if (raw == null) {
      return { mode: 'error', cfg: null,
               problems: ['config not generated — run node scripts/build-config.js'] };
    }
    if (typeof raw !== 'object') {
      return { mode: 'error', cfg: null, problems: ['config must be a JSON object'] };
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'condition_6_risk_range')) {
      return { mode: 'off', cfg: null, problems: [] };
    }
    var sec = raw.condition_6_risk_range;
    if (sec == null || typeof sec !== 'object' || Array.isArray(sec)) {
      return { mode: 'error', cfg: null, problems: ['condition_6_risk_range must be an object'] };
    }
    if (sec.enabled === false) return { mode: 'off', cfg: null, problems: [] };

    var problems = [];
    var num = function (v) { return typeof v === 'number' && Number.isFinite(v); };
    if (sec.enabled !== true) problems.push('enabled must be a boolean (true or false)');
    if (!num(sec.min_risk_points) || sec.min_risk_points < 0) problems.push('min_risk_points must be a finite number >= 0');
    if (!num(sec.max_risk_points) || sec.max_risk_points <= 0) problems.push('max_risk_points must be a finite number > 0');
    if (problems.length === 0 && !(sec.max_risk_points > sec.min_risk_points)) {
      problems.push('max_risk_points must be greater than min_risk_points');
    }
    if (problems.length) {
      return { mode: 'error', cfg: null,
               problems: problems.map(function (p) { return 'condition_6_risk_range: ' + p; }) };
    }
    return { mode: 'active', cfg: { minRisk: sec.min_risk_points, maxRisk: sec.max_risk_points }, problems: [] };
  }

  /**
   * @param {Array} c5Marks  evaluateCondition5() result (each carries eDistance).
   * @param {{minRisk:number, maxRisk:number}} cfg  normalizeCondition6().cfg
   * @returns {Array} the C5 marks whose E candle distance lies in [minRisk, maxRisk).
   */
  function evaluateCondition6(c5Marks, cfg) {
    var out = [];
    if (!c5Marks || !c5Marks.length) return out;
    c5Marks.forEach(function (m) {
      if (typeof m.eDistance === 'number' && Number.isFinite(m.eDistance) &&
          m.eDistance >= cfg.minRisk && m.eDistance < cfg.maxRisk) out.push(m);
    });
    return out;
  }

  /**
   * Combined C1 AND C2 display. C2 only ever keeps C1 marks, so a candle that is in
   * both lists satisfies C1 and C2 together. Each C1 mark becomes exactly one entry:
   *   kind 'C1+C2+C3+C4+C5+C6' — the candle also passed Condition 6 (its E distance is inside the risk range)
   *   kind 'C1+C2+C3+C4+C5' — the candle also passed Condition 5 (carries the distances as well)
   *   kind 'C1+C2+C3+C4' — the candle also passed Condition 4 (carries hitTime / hitValue as well)
   *   kind 'C1+C2+C3' — the candle also passed Condition 3 (carries spreadPct as well)
   *   kind 'C1+C2'    — the candle also passed Condition 2 (carries smaFast / smaSlow)
   *   kind 'C1'       — Condition 1 only (C2 off, failed, or not yet warmed up)
   * c3Marks .. c6Marks are optional. @returns {Array} ascending by time, one entry per C1 mark.
   */
  function combineMarks(c1Marks, c2Marks, c3Marks, c4Marks, c5Marks, c6Marks) {
    var key = function (m) { return m.time + '|' + m.pattern; };
    var c2 = new Map(), c3 = new Map(), c4 = new Map(), c5 = new Map(), c6 = new Map();
    (c6Marks || []).forEach(function (m) { c6.set(key(m), m); });
    (c5Marks || []).forEach(function (m) { c5.set(key(m), m); });
    (c2Marks || []).forEach(function (m) { c2.set(key(m), m); });
    (c3Marks || []).forEach(function (m) { c3.set(key(m), m); });
    (c4Marks || []).forEach(function (m) { c4.set(key(m), m); });
    return (c1Marks || []).map(function (m) {
      var h6 = c6.get(key(m)), h5 = c5.get(key(m)), h4 = c4.get(key(m)), h3 = c3.get(key(m)), h2 = c2.get(key(m));
      if (h6 && h5 && h4 && h3 && h2) return Object.assign({}, h6, { kind: 'C1+C2+C3+C4+C5+C6' });
      if (h5 && h4 && h3 && h2) return Object.assign({}, h5, { kind: 'C1+C2+C3+C4+C5' });
      if (h4 && h3 && h2) return Object.assign({}, h4, { kind: 'C1+C2+C3+C4' });
      if (h3 && h2) return Object.assign({}, h3, { kind: 'C1+C2+C3' });
      if (h2) return Object.assign({}, h2, { kind: 'C1+C2' });
      return Object.assign({}, m, { kind: 'C1' });
    }).sort(function (a, b) { return a.time - b.time; });
  }

  /**
   * The whole LTF chain C1 -> C5 in one call — the single place that decides which condition feeds which.
   * The page draws from it and the strategy simulation / back-test consume the same result.
   *
   * @param {Array} ltfCandles  LTF candles, ascending.
   * @param {Array<{from:number,to:number,pattern:string}>} windows  Matched HTF zones.
   * @param {{c1,c2,c3,c4,c5,c6?}} cfgs  the normalizeConditionN() results (mode + cfg).
   * @param {function(Array<number>, number): Array} rsiArray  Wilder RSI (confirmation.js rsiArray).
   * @returns {{c1:Array,c2:Array,c3:Array,c4:Array,c5:Array,marks:Array}} each level's surviving marks,
   *          and `marks` = combineMarks() — one entry per C1 mark with its highest `kind`.
   *          A level whose config is not 'active' (or whose predecessor is not) yields [].
   */
  function runChain(ltfCandles, windows, cfgs, rsiArray) {
    var out = { c1: [], c2: [], c3: [], c4: [], c5: [], c6: [], marks: [], fullKind: null };
    if (!cfgs || !cfgs.c1 || cfgs.c1.mode !== 'active' || !ltfCandles || !ltfCandles.length) return out;
    var active = function (c) { return !!c && c.mode === 'active'; };
    var closes = ltfCandles.map(function (c) { return c.close; });

    out.c1 = evaluateCondition1(ltfCandles, rsiArray(closes, cfgs.c1.cfg.rsiPeriod), windows || [], cfgs.c1.cfg);
    var a2 = active(cfgs.c2);
    if (a2) out.c2 = evaluateCondition2(ltfCandles, out.c1, cfgs.c2.cfg);
    var a3 = a2 && active(cfgs.c3);
    if (a3) out.c3 = evaluateCondition3(ltfCandles, out.c2, cfgs.c3.cfg, cfgs.c2.cfg);
    var a4 = a3 && active(cfgs.c4);
    if (a4) {
      var rsiSma = smaNullableArray(rsiArray(closes, cfgs.c4.cfg.rsiPeriod), cfgs.c4.cfg.smaPeriod);
      out.c4 = evaluateCondition4(ltfCandles, out.c3, rsiSma, cfgs.c4.cfg);
    }
    var a5 = a4 && active(cfgs.c5);
    if (a5) out.c5 = evaluateCondition5(ltfCandles, out.c4, cfgs.c5.cfg);
    var a6 = a5 && active(cfgs.c6);
    if (a6) out.c6 = evaluateCondition6(out.c5, cfgs.c6.cfg);
    out.marks = combineMarks(out.c1, out.c2, out.c3, out.c4, out.c5, out.c6);
    // the kind of the last active level: only marks of this kind are full signals (strategies read it from here)
    out.fullKind = a6 ? 'C1+C2+C3+C4+C5+C6' : a5 ? 'C1+C2+C3+C4+C5' : null;
    return out;
  }

  /** Matched HTF states -> the zone windows the LTF conditions start from. */
  function windowsFromStates(states, htfSec) {
    var out = [];
    states.forEach(function (s) {
      if (s.state === 'Matched') out.push({ from: s.closeTime - htfSec, to: s.closeTime, pattern: s.pattern });
    });
    return out;
  }

  return {
    runChain: runChain,
    windowsFromStates: windowsFromStates,
    normalizeCondition1: normalizeCondition1,
    evaluateCondition1: evaluateCondition1,
    normalizeCondition2: normalizeCondition2,
    evaluateCondition2: evaluateCondition2,
    normalizeCondition3: normalizeCondition3,
    evaluateCondition3: evaluateCondition3,
    normalizeCondition6: normalizeCondition6,
    evaluateCondition6: evaluateCondition6,
    normalizeCondition5: normalizeCondition5,
    evaluateCondition5: evaluateCondition5,
    normalizeCondition4: normalizeCondition4,
    evaluateCondition4: evaluateCondition4,
    smaNullableArray: smaNullableArray,
    combineMarks: combineMarks,
    spreadPct: spreadPct,
    smaArray: smaArray,
  };
}));
