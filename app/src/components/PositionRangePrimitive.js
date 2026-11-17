function fmtPrecioCaja(n, prec = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: prec,
    maximumFractionDigits: prec,
  });
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

class PositionRangeRenderer {
  constructor() {
    this._coords = null;
  }

  setCoords(coords) {
    this._coords = coords;
  }

  draw(target) {
    const c = this._coords;
    if (!c) return;

    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio, verticalPixelRatio }) => {
      const hpr = horizontalPixelRatio || 1;
      const vpr = verticalPixelRatio || 1;

      const leftPx = Math.round(c.xStart * hpr);
      const rightPx = Math.round(c.xEnd * hpr);
      const widthPx = rightPx - leftPx;
      if (widthPx <= 2 || rightPx < 0 || leftPx > bitmapSize.width) return;

      const yEntryPx = Math.round(c.yEntry * vpr);
      const yTpPx = Math.round(c.yTp * vpr);
      const ySlPx = Math.round(c.ySl * vpr);
      const strokeW = Math.max(1, Math.round(1.5 * hpr));

      const drawZone = (yA, yB, fillColor, borderColor, labelText, labelTextColor) => {
        const top = Math.min(yA, yB);
        const bottom = Math.max(yA, yB);
        const h = bottom - top;
        if (h <= 1 || bottom < 0 || top > bitmapSize.height) return;

        context.save();
        context.fillStyle = fillColor;
        context.fillRect(leftPx, top, widthPx, h);

        context.strokeStyle = borderColor;
        context.lineWidth = strokeW;
        context.strokeRect(leftPx + strokeW * 0.5, top + strokeW * 0.5, Math.max(1, widthPx - strokeW), Math.max(1, h - strokeW));

        if (labelText && rightPx > 24 * hpr && h >= 12 * vpr) {
          const fontSize = Math.round(10 * vpr);
          context.font = `600 ${fontSize}px 'JetBrains Mono', monospace`;
          const textW = context.measureText(labelText).width;
          const padX = Math.round(5 * hpr);
          const padY = Math.round(3 * vpr);
          const pillW = textW + padX * 2;
          const pillH = fontSize + padY * 2;

          const minX = Math.round(6 * hpr);
          const visibleRight = Math.min(bitmapSize.width - Math.round(6 * hpr), rightPx - Math.round(4 * hpr));
          const maxX = Math.max(minX, visibleRight - pillW);
          const preferredX = leftPx + Math.round(6 * hpr);
          const textX = Math.max(minX, Math.min(preferredX, maxX));
          // Colocar etiqueta dentro de la caja visible, cerca del borde exterior
          const isTopZone = top < yEntryPx;
          let textY;
          if (h >= pillH + Math.round(10 * vpr)) {
            textY = isTopZone ? top + Math.round(6 * vpr) : bottom - pillH - Math.round(6 * vpr);
          } else {
            textY = top + Math.round((h - pillH) / 2);
          }
          textY = Math.max(Math.round(4 * vpr), Math.min(bitmapSize.height - pillH - Math.round(4 * vpr), textY));

          drawRoundedRect(context, textX, textY, pillW, pillH, Math.round(4 * hpr));
          context.fillStyle = 'rgba(9, 9, 11, 0.94)';
          context.fill();
          context.strokeStyle = borderColor;
          context.lineWidth = Math.max(1, Math.round(1 * hpr));
          context.stroke();

          context.fillStyle = labelTextColor;
          context.textBaseline = 'middle';
          context.fillText(labelText, textX + padX, textY + pillH / 2 + 0.5 * vpr);
        }
        context.restore();
      };

      drawZone(
        yEntryPx,
        yTpPx,
        'rgba(34, 197, 94, 0.18)',
        '#22C55E',
        c.tpLabel,
        '#86EFAC'
      );

      drawZone(
        yEntryPx,
        ySlPx,
        'rgba(239, 68, 68, 0.18)',
        '#EF4444',
        c.slLabel,
        '#FCA5A5'
      );
    });
  }
}

class PositionRangePaneView {
  constructor(renderer) {
    this._renderer = renderer;
  }

  zOrder() {
    return 'top';
  }

  renderer() {
    return this._renderer;
  }
}

/**
 * Primitive de lightweight-charts que dibuja las zonas TP (verde) y SL (roja)
 * de la posición abierta entre la vela de entrada y la vela actual + 15 velas.
 */
export default class PositionRangePrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._data = null;
    this._renderer = new PositionRangeRenderer();
    this._paneView = new PositionRangePaneView(this._renderer);
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  setData(data) {
    this._data = data || null;
    this.updateAllViews();
    this._requestUpdate?.();
  }

  updateAllViews() {
    const d = this._data;
    if (!d || !this._chart || !this._series) {
      this._renderer.setCoords(null);
      return;
    }

    const ts = this._chart.timeScale();
    const yEntry = this._series.priceToCoordinate(d.entry);
    const yTp = this._series.priceToCoordinate(d.tp);
    const ySl = this._series.priceToCoordinate(d.sl);
    if (!Number.isFinite(yEntry) || !Number.isFinite(yTp) || !Number.isFinite(ySl)) {
      this._renderer.setCoords(null);
      return;
    }

    const c0 = ts.logicalToCoordinate(0);
    const c1 = ts.logicalToCoordinate(1);
    const barW =
      c0 !== null && c1 !== null && Math.abs(c1 - c0) > 0.2
        ? Math.abs(c1 - c0)
        : Number(ts.options()?.barSpacing) || 6;

    let xStart = ts.timeToCoordinate(d.entryTime);
    if (xStart === null && d.firstTime) {
      const xFirst = ts.timeToCoordinate(d.firstTime);
      if (xFirst !== null && d.barsBeforeFirst > 0) {
        xStart = xFirst - d.barsBeforeFirst * barW;
      }
    }
    const xLast = ts.timeToCoordinate(d.lastTime);

    if (!Number.isFinite(xStart) || !Number.isFinite(xLast)) {
      // Respaldo con índices lógicos si alguna vela quedó fuera del rango calculado
      const logStart = d.fallbackStartLogical ?? 0;
      const logEnd = (d.fallbackLastLogical ?? 0) + 15;
      const lx1 = ts.logicalToCoordinate(logStart);
      const lx2 = ts.logicalToCoordinate(logEnd);
      if (!Number.isFinite(lx1) || !Number.isFinite(lx2)) {
        this._renderer.setCoords(null);
        return;
      }
      xStart = lx1;
      var xEnd = lx2;
    } else {
      var xEnd = xLast + 15 * barW;
    }

    const isShort = String(d.side || '').toUpperCase() === 'SHORT';
    const tpArrow = isShort ? '↓' : '↑';
    const slArrow = isShort ? '↑' : '↓';
    const tpGain = (100 * 10 * Math.abs(d.tp - d.entry)) / d.entry;
    const slLoss = (100 * 10 * Math.abs(d.sl - d.entry)) / d.entry;

    this._renderer.setCoords({
      xStart,
      xEnd: Math.max(xStart + barW * 2, xEnd),
      yEntry,
      yTp,
      ySl,
      tpLabel: `TP ${tpArrow} $${fmtPrecioCaja(d.tp, d.prec)} (+$${tpGain.toFixed(2)})`,
      slLabel: `SL ${slArrow} $${fmtPrecioCaja(d.sl, d.prec)} (−$${slLoss.toFixed(2)})`,
    });
  }

  paneViews() {
    return [this._paneView];
  }

  autoscaleInfo() {
    const d = this._data;
    if (!d) return null;
    const minValue = Math.min(d.entry, d.tp, d.sl);
    const maxValue = Math.max(d.entry, d.tp, d.sl);
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return null;
    return {
      priceRange: { minValue, maxValue },
    };
  }
}
