/**
 * trendlines.js — trend-line drawing helpers (pure, no DOM, no chart library).
 *
 * Loaded by web/index.html (as window.TickLines) and by tests/trendlines.test.js (via require).
 *
 * A trend line is stored as TIME and PRICE anchors, not pixels: { id, t1, p1, t2, p2, color, extend }.
 * t is an epoch second, p a price. That makes a line independent of the zoom, the timeframe and the window size: on any
 * timeframe a time maps to a (fractional) bar position, and a bar position maps to a pixel through the chart.
 *
 * Bar position ("logical index"): candles are contiguous buckets of `tfSec` seconds starting at `t0` (the feed gaps are
 * forward-filled), so  logical = (t - t0) / tfSec  and  t = t0 + logical * tfSec — also beyond the first / last candle,
 * which is what lets a line start before or extend after the data.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TickLines = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'tickcharts.trendlines.v1';
  var COLORS = ['#ffeb3b', '#ff9800', '#e040fb', '#00e5ff', '#69f0ae', '#ffffff'];

  function toLogical(t0, tfSec, t) { return (t - t0) / tfSec; }
  function toTime(t0, tfSec, logical) { return t0 + logical * tfSec; }

  /** Which storage bucket a panel's lines live in. */
  function key(symbol, date, panel) { return symbol + '|' + date + '|' + panel; }

  var seq = 0;
  /** A new line from two anchors. */
  function newLine(t1, p1, t2, p2, opts) {
    opts = opts || {};
    return {
      id: 'tl' + Date.now().toString(36) + (seq++).toString(36),
      t1: t1, p1: p1, t2: t2, p2: p2,
      color: opts.color || COLORS[0],
      extend: opts.extend === undefined ? true : !!opts.extend,
    };
  }

  /** Keep only well-formed lines (the stored JSON is untrusted: it may be old, hand-edited or corrupt). */
  function sanitize(lines) {
    if (!Array.isArray(lines)) return [];
    var out = [];
    lines.forEach(function (l) {
      if (!l || typeof l !== 'object') return;
      var nums = [l.t1, l.p1, l.t2, l.p2];
      if (!nums.every(function (v) { return typeof v === 'number' && Number.isFinite(v); })) return;
      if (l.t1 === l.t2 && l.p1 === l.p2) return;                       // a point, not a line
      out.push({
        id: typeof l.id === 'string' && l.id ? l.id : newLine(0, 0, 1, 1).id,
        t1: l.t1, p1: l.p1, t2: l.t2, p2: l.p2,
        color: typeof l.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(l.color) ? l.color : COLORS[0],
        extend: l.extend !== false,
      });
    });
    return out;
  }

  /** Read every saved bucket from a Storage-like object. Never throws. */
  function loadAll(storage) {
    try {
      var raw = storage && storage.getItem(STORAGE_KEY);
      var all = raw ? JSON.parse(raw) : {};
      if (!all || typeof all !== 'object' || Array.isArray(all)) return {};
      var out = {};
      Object.keys(all).forEach(function (k) { var s = sanitize(all[k]); if (s.length) out[k] = s; });
      return out;
    } catch (e) { return {}; }
  }

  /** Write every bucket back. Never throws (private windows / blocked storage just do not persist). Returns true if saved. */
  function saveAll(storage, all) {
    try {
      var clean = {};
      Object.keys(all || {}).forEach(function (k) { if (all[k] && all[k].length) clean[k] = all[k]; });
      storage.setItem(STORAGE_KEY, JSON.stringify(clean));
      return true;
    } catch (e) { return false; }
  }

  /**
   * Pixel end points of a line.
   * @param {Object} line
   * @param {{x:function(number):number, y:function(number):number}} map  time -> x pixel, price -> y pixel
   * @param {number} width  width of the plot area in pixels (the right edge a line is extended to)
   * @returns {{x1,y1,x2,y2,ex,ey}|null} (x1,y1)-(x2,y2) the anchors; (ex,ey) the end of the extension to the right edge,
   *          equal to (x2,y2) when the line does not extend; null when a coordinate is not available.
   */
  function screenPoints(line, map, width) {
    var x1 = map.x(line.t1), y1 = map.y(line.p1), x2 = map.x(line.t2), y2 = map.y(line.p2);
    if (![x1, y1, x2, y2].every(function (v) { return typeof v === 'number' && Number.isFinite(v); })) return null;
    var ex = x2, ey = y2;
    if (line.extend && x1 !== x2) {
      var rightmost = x1 > x2 ? 1 : 2;                                    // extend beyond whichever anchor is further right
      var ax = rightmost === 1 ? x1 : x2, ay = rightmost === 1 ? y1 : y2;
      if (width > ax) { var slope = (y2 - y1) / (x2 - x1); ex = width; ey = ay + slope * (width - ax); }
      else { ex = ax; ey = ay; }
    }
    return { x1: x1, y1: y1, x2: x2, y2: y2, ex: ex, ey: ey, rightmost: x1 >= x2 ? 1 : 2 };
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len2 = dx * dx + dy * dy;
    var t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
    var cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  }

  /**
   * What is under the pointer: a handle ('p1' / 'p2') beats the line body ('body'); the line drawn last (on top) wins.
   * @returns {{id:string, part:'p1'|'p2'|'body'}|null}
   */
  function hitTest(lines, map, width, x, y, tol) {
    tol = tol === undefined ? 6 : tol;
    for (var i = lines.length - 1; i >= 0; i--) {
      var s = screenPoints(lines[i], map, width);
      if (!s) continue;
      if (Math.hypot(x - s.x1, y - s.y1) <= tol + 2) return { id: lines[i].id, part: 'p1' };
      if (Math.hypot(x - s.x2, y - s.y2) <= tol + 2) return { id: lines[i].id, part: 'p2' };
    }
    for (var j = lines.length - 1; j >= 0; j--) {
      var s2 = screenPoints(lines[j], map, width);
      if (!s2) continue;
      if (distToSegment(x, y, s2.x1, s2.y1, s2.ex, s2.ey) <= tol) return { id: lines[j].id, part: 'body' };
      if (s2.ex === s2.x2 && distToSegment(x, y, s2.x1, s2.y1, s2.x2, s2.y2) <= tol) return { id: lines[j].id, part: 'body' };
    }
    return null;
  }

  /** The line moved by a time offset and a price offset. */
  function moved(line, dt, dp) {
    return Object.assign({}, line, { t1: line.t1 + dt, t2: line.t2 + dt, p1: line.p1 + dp, p2: line.p2 + dp });
  }

  /** The line with one anchor replaced. */
  function withAnchor(line, which, t, p) {
    return which === 'p1' ? Object.assign({}, line, { t1: t, p1: p }) : Object.assign({}, line, { t2: t, p2: p });
  }

  /**
   * A line parallel to `base` through the point (t, p): the same two times and the same slope, shifted up or down so that it
   * passes through p at time t. Colour and extension are inherited. null for a vertical base line (no slope to copy).
   */
  function parallelThrough(base, t, p) {
    var onBase = priceAt(base, t);
    if (onBase === null || typeof onBase !== 'number' || !Number.isFinite(onBase)) return null;
    var dp = p - onBase;
    if (dp === 0) return null;                                          // it would lie exactly on the base line
    return newLine(base.t1, base.p1 + dp, base.t2, base.p2 + dp, { color: base.color, extend: base.extend });
  }

  /** Price of a line at a given time (null for a vertical line). */
  function priceAt(line, t) {
    if (line.t1 === line.t2) return null;
    return line.p1 + (line.p2 - line.p1) * (t - line.t1) / (line.t2 - line.t1);
  }

  return {
    STORAGE_KEY: STORAGE_KEY, COLORS: COLORS,
    toLogical: toLogical, toTime: toTime, key: key, newLine: newLine, sanitize: sanitize,
    loadAll: loadAll, saveAll: saveAll, screenPoints: screenPoints, distToSegment: distToSegment,
    hitTest: hitTest, moved: moved, withAnchor: withAnchor, priceAt: priceAt, parallelThrough: parallelThrough,
  };
}));
