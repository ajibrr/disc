/**
 * oi-flow.js — option-chain flow (CE / PE open-interest CHANGE) helpers. Pure, no DOM.
 *
 * Loaded by web/index.html (as window.TickFlow) and by tests/oi-flow.test.js (via require).
 *
 * build-data.js stores the flow of every session as { t: [epoch s], dce: [...], dpe: [...] }: one snapshot per minute and
 * the CE / PE open-interest change during the minute that ENDS at that snapshot (the file's own `ce_oi_change` /
 * `pe_oi_change`). The HTF charts plot the change per candle.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TickFlow = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * CE / PE open-interest change of each candle = the changes of the minutes that end inside it.
   *
   * A snapshot stamped T belongs to the minute M = floor(T / 60) * 60 (a row stamped 09:20:01 is the 09:20 minute).
   * The minute ending at M lies inside a candle that starts at `t` and lasts `tfSec` when  t < M <= t + tfSec.
   * For 1-minute candles that is exactly one snapshot, so the plotted value IS the file's per-minute change; longer
   * candles add up the minutes they contain (the change over the candle). Only minutes that ended by the candle's
   * close are used, so a candle never carries a number from after it closed.
   *
   * @param {{t:number[],dce:number[],dpe:number[]}|null|undefined} flow
   * @param {Array<{time:number}>} candles  ascending candles of one timeframe
   * @param {number} tfSec
   * @returns {Array<{dce:number,dpe:number,minutes:number,lastSnapshot:number}|null>} one entry per candle; null when
   *          no snapshot minute ends inside the candle (or the session has no flow data).
   */
  function changePerCandle(flow, candles, tfSec) {
    var out = new Array(candles.length).fill(null);
    if (!flow || !flow.t || !flow.t.length) return out;
    var k = 0;                                                // first snapshot not yet consumed
    for (var i = 0; i < candles.length; i++) {
      var t0 = candles[i].time, t1 = t0 + tfSec;
      var sumCe = 0, sumPe = 0, n = 0, last = null;
      // skip snapshot minutes that ended at or before this candle opened
      while (k < flow.t.length && Math.floor(flow.t[k] / 60) * 60 <= t0) k++;
      var j = k;
      while (j < flow.t.length && Math.floor(flow.t[j] / 60) * 60 <= t1) {
        sumCe += flow.dce[j]; sumPe += flow.dpe[j]; n++; last = flow.t[j];
        j++;
      }
      if (n) out[i] = { dce: sumCe, dpe: sumPe, minutes: n, lastSnapshot: last };
      k = j;                                                  // the next candle starts after these minutes
    }
    return out;
  }

  /** +1,234,567 / −89,000 / 0 — full number, thousands separators, explicit sign. */
  function fmtFull(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    var s = Math.abs(Math.round(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v > 0 ? '+' : v < 0 ? '−' : '') + s;
  }

  /** Short form for the price axis: 28.72B, −1.51M, 840K, 0. */
  function fmtCompact(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    var a = Math.abs(v), sign = v < 0 ? '−' : '';
    if (a >= 1e9) return sign + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sign + (a / 1e3).toFixed(0) + 'K';
    return sign + Math.round(a);
  }


  /**
   * The per-session option-chain flow for one calendar date: { t, dce, dpe } = the snapshot time (epoch s) and the CE / PE
   * open-interest CHANGE of that snapshot's minute (the change during the minute that ends at the snapshot).
   *
   * Rows carry either `timestamp` ("YYYY-MM-DD HH:MM:SS", IST) or `timestamp_epoch`. Some files hold one row per minute,
   * others one per second — either way only the FIRST row of each minute is kept (at most one snapshot per minute).
   * The change is the row's own `ce_oi_change` / `pe_oi_change` when it has them; a file with only the cumulative values
   * (no change columns) gets it derived: this snapshot's cumulative value minus the previous snapshot's (the first
   * snapshot's cumulative value, the series starting from zero). In the per-minute files the change columns equal exactly
   * that difference, so both routes agree.
   */
  function extractFlow(flowRows, date) {
    const out = { t: [], dce: [], dpe: [] };
    if (!Array.isArray(flowRows)) return out;
    const rows = [];
    for (const r of flowRows) {
      if (String(r.timestamp || '').slice(0, 10) !== date) continue;
      let t = Number(r.timestamp_epoch);
      if (!Number.isFinite(t)) {
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(r.timestamp || ''));
        if (!m) continue;
        t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 - 19800;   // IST = UTC+5:30
      }
      if (typeof r.cumulative_ce !== 'number' || typeof r.cumulative_pe !== 'number') continue;
      rows.push({ t, cce: r.cumulative_ce, cpe: r.cumulative_pe,
                  dce: typeof r.ce_oi_change === 'number' ? r.ce_oi_change : null,
                  dpe: typeof r.pe_oi_change === 'number' ? r.pe_oi_change : null });
    }
    rows.sort((a, b) => a.t - b.t);
    let lastBucket = null, prevCe = 0, prevPe = 0;
    for (const r of rows) {
      const bucket = Math.floor(r.t / 60);
      if (bucket === lastBucket) continue;
      lastBucket = bucket;
      out.t.push(r.t);
      out.dce.push(r.dce !== null ? r.dce : r.cce - prevCe);
      out.dpe.push(r.dpe !== null ? r.dpe : r.cpe - prevPe);
      prevCe = r.cce; prevPe = r.cpe;
    }
    return out;
  }

  return { changePerCandle: changePerCandle, extractFlow: extractFlow, fmtFull: fmtFull, fmtCompact: fmtCompact };
}));
