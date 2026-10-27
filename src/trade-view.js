/**
 * trade-view.js — how a simulated trade is drawn on the LTF chart (pure geometry, no DOM, no canvas).
 *
 * For one trade it returns a list of shapes in pixel coordinates; the page paints them behind the candles:
 *   · two full-height COLUMNS: the entry candle (white) and the exit candle (green for a profit, red for a loss),
 *   · the POSITION BOX from the entry candle to the exit candle: a green zone between the entry price and the target, a red zone
 *     between the entry price and the stop, and a coloured outline (green = winner, red = loser, grey = open),
 *   · three dashed LEVEL lines across the box: entry (white), target (green), stop (red).
 * An open trade (no exit yet, e.g. during a bar replay) has its box run on to the right edge of the chart.
 *
 * Coordinates come from the chart through `c`:  xOf(time) → centre x of the candle, yOf(price) → y, bar = candle width in px,
 * right = x of the right edge, height = chart height. A missing coordinate (a candle outside the view) returns [].
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TickTradeView = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLORS = {
    entryColumn: 'rgba(255,255,255,0.13)',
    winColumn: 'rgba(0,230,118,0.20)', lossColumn: 'rgba(255,23,68,0.20)', flatColumn: 'rgba(158,158,158,0.20)',
    profitZone: 'rgba(0,230,118,0.13)', lossZone: 'rgba(255,23,68,0.13)',
    win: 'rgba(0,230,118,0.85)', loss: 'rgba(255,23,68,0.85)', flat: 'rgba(158,158,158,0.85)', open: 'rgba(255,255,255,0.55)',
    entryLine: 'rgba(255,255,255,0.8)', targetLine: 'rgba(0,230,118,0.8)', stopLine: 'rgba(255,23,68,0.8)',
  };
  var fin = function (v) { return typeof v === 'number' && Number.isFinite(v); };

  /**
   * @param {{side:'LONG'|'SHORT', entryTime:number, exitTime:number|null, entry:number, stop:number, target:number, pnl?:number, open?:boolean}} b
   * @param {{xOf:function, yOf:function, bar:number, right:number, height:number}} c
   * @returns {Array<{type:'rect'|'line'|'outline', ...}>}
   */
  function shapes(b, c) {
    var out = [];
    if (!b || !c) return out;
    var xe = c.xOf(b.entryTime);
    var xx = b.open || b.exitTime == null ? null : c.xOf(b.exitTime);
    var yEntry = c.yOf(b.entry), yStop = c.yOf(b.stop), yTarget = c.yOf(b.target);
    if (!fin(xe) || !fin(yEntry) || !fin(yStop) || !fin(yTarget)) return out;
    if (!(b.open || b.exitTime == null) && !fin(xx)) return out;
    var half = Math.max(1, c.bar) / 2;
    var left = xe - half, right = (b.open || b.exitTime == null) ? c.right : xx + half;
    if (!(right > left)) return out;
    var result = b.open || b.exitTime == null ? 'open' : (b.pnl > 0 ? 'win' : b.pnl < 0 ? 'loss' : 'flat');

    // 1) the entry and exit candles, full height
    out.push({ type: 'rect', x: xe - half, y: 0, w: Math.max(1, c.bar), h: c.height, fill: COLORS.entryColumn, role: 'entry-column' });
    if (result !== 'open') {
      out.push({ type: 'rect', x: xx - half, y: 0, w: Math.max(1, c.bar), h: c.height,
                 fill: result === 'win' ? COLORS.winColumn : result === 'loss' ? COLORS.lossColumn : COLORS.flatColumn, role: 'exit-column' });
    }
    // 2) the position box: profit zone (entry -> target) and loss zone (entry -> stop)
    var w = right - left;
    out.push({ type: 'rect', x: left, y: Math.min(yEntry, yTarget), w: w, h: Math.abs(yTarget - yEntry), fill: COLORS.profitZone, role: 'profit-zone' });
    out.push({ type: 'rect', x: left, y: Math.min(yEntry, yStop), w: w, h: Math.abs(yStop - yEntry), fill: COLORS.lossZone, role: 'loss-zone' });
    var top = Math.min(yStop, yTarget), bottom = Math.max(yStop, yTarget);
    out.push({ type: 'outline', x: left, y: top, w: w, h: bottom - top, color: COLORS[result], role: 'outline' });
    // 3) dashed levels
    out.push({ type: 'line', x1: left, y1: yEntry, x2: right, y2: yEntry, color: COLORS.entryLine, dash: [4, 3], role: 'entry-line' });
    out.push({ type: 'line', x1: left, y1: yTarget, x2: right, y2: yTarget, color: COLORS.targetLine, dash: [4, 3], role: 'target-line' });
    out.push({ type: 'line', x1: left, y1: yStop, x2: right, y2: yStop, color: COLORS.stopLine, dash: [4, 3], role: 'stop-line' });
    return out;
  }

  /** the label shown on the chart for the entry / exit marker (emoji so they stand out) */
  function entryLabel(side, price, decimals, open) {
    return (side === 'LONG' ? '🟢 LONG ' : '🔴 SHORT ') + price.toFixed(decimals) + (open ? ' (open)' : '');
  }
  function exitLabel(reason, pnl) {
    var icon = reason === 'TARGET' ? '✅ TP ' : reason === 'STOP' ? '❌ SL ' : reason === 'HARD' ? '⏰ HARD ' : '🔚 EOD ';
    return icon + (pnl > 0 ? '+' : pnl < 0 ? '−' : '') + Math.abs(pnl).toFixed(2);
  }

  return { shapes: shapes, entryLabel: entryLabel, exitLabel: exitLabel, COLORS: COLORS };
}));
