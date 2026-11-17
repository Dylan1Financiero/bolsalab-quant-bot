import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import PositionRangePrimitive from './PositionRangePrimitive';

function mapLineStyle(estilo) {
  if (estilo === 'punteada') return LineStyle.Dotted;
  if (estilo === 'rayas') return LineStyle.Dashed;
  return LineStyle.Solid;
}

function dedupSortPoints(pts) {
  const byTime = new Map();
  for (const p of pts) {
    if (!Number.isFinite(p.time) || !Number.isFinite(p.value)) continue;
    byTime.set(p.time, p);
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

function fmtNumPrice(n, dec = null) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const d = dec !== null ? dec : Math.abs(v) > 0 && Math.abs(v) < 10 ? 4 : Math.abs(v) < 1000 ? 2 : 1;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function parseEntryTimeSec(position) {
  if (!position) return null;
  if (position.entry_utc) {
    const parsed = Date.parse(position.entry_utc);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  const candleTs = Number(position.entry_candle);
  if (Number.isFinite(candleTs) && candleTs > 0) return candleTs;
  return null;
}

/**
 * Ajusta un timestamp unix (en segundos) a la vela correspondiente en `datos`
 * (la última vela cuyo time <= targetSec), o retorna el índice/tiempo más cercano.
 */
function findBarForTime(targetSec, datos) {
  if (!Array.isArray(datos) || datos.length === 0 || !Number.isFinite(targetSec)) {
    return null;
  }
  if (targetSec < datos[0].time) {
    const step = datos.length > 1 ? Math.max(1, datos[1].time - datos[0].time) : 60;
    const barsBeforeFirst = Math.max(0, Math.round((datos[0].time - targetSec) / step));
    return { index: -barsBeforeFirst, time: datos[0].time, barsBeforeFirst };
  }
  let lo = 0;
  let hi = datos.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (datos[mid].time <= targetSec) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { index: best, time: datos[best].time, barsBeforeFirst: 0 };
}

export default function BotCandlesChart({
  velasData,
  position,
  analisis = null,
  mostrarDibujo = true,
  altura = 460,
  herramienta = null,
  dibujosUsuario = [],
  onAgregarDibujo,
  fitTrigger = 0,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volSeriesRef = useRef(null);
  const positionPrimitiveRef = useRef(null);

  const analisisSeriesRef = useRef([]);
  const analisisPriceLinesRef = useRef([]);
  const entryPriceLineRef = useRef(null);
  const userSeriesRef = useRef([]);

  const datosRef = useRef([]);
  const prevAssetTfRef = useRef('');
  const prevPosStateRef = useRef({ had: false, asset: null });
  const closedMarkerTimeRef = useRef(null);

  const [primerPunto, setPrimerPunto] = useState(null);
  const [velaHover, setVelaHover] = useState(null);

  const herramientaRef = useRef(herramienta);
  herramientaRef.current = herramienta;
  const primerPuntoRef = useRef(primerPunto);
  primerPuntoRef.current = primerPunto;
  const onAgregarDibujoRef = useRef(onAgregarDibujo);
  onAgregarDibujoRef.current = onAgregarDibujo;

  useEffect(() => {
    setPrimerPunto(null);
  }, [herramienta, velasData?.asset, velasData?.tf]);

  const hasCandles = Boolean(velasData && Array.isArray(velasData.candles) && velasData.candles.length > 0);

  useEffect(() => {
    if (fitTrigger > 0 && chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [fitTrigger]);

  // 1. Crear instancia única del chart + primitive de posición (se mantiene al hacer zoom/scroll)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasCandles) return undefined;

    const chart = createChart(el, {
      width: el.clientWidth || 760,
      height: altura,
      layout: {
        background: { type: ColorType.Solid, color: '#09090B' },
        textColor: '#64748B',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#14141D' },
        horzLines: { color: '#14141D' },
      },
      rightPriceScale: {
        borderColor: '#1E1E2A',
        scaleMargins: { top: 0.08, bottom: 0.20 },
      },
      timeScale: {
        borderColor: '#1E1E2A',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 18,
      },
      crosshair: {
        vertLine: { color: 'rgba(139, 92, 246, 0.45)', labelBackgroundColor: '#1E1E2A' },
        horzLine: { color: 'rgba(139, 92, 246, 0.45)', labelBackgroundColor: '#1E1E2A' },
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22C55E',
      downColor: '#EF4444',
      borderUpColor: '#22C55E',
      borderDownColor: '#EF4444',
      wickUpColor: '#22C55E',
      wickDownColor: '#EF4444',
      priceLineVisible: true,
      priceLineColor: '#22C55E',
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
    });

    const posPrimitive = new PositionRangePrimitive();
    candleSeries.attachPrimitive(posPrimitive);

    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;
    positionPrimitiveRef.current = posPrimitive;

    const handleCrosshair = (param) => {
      const datos = datosRef.current;
      const ultima = datos[datos.length - 1];
      if (!param || !param.time) {
        if (ultima) setVelaHover(ultima);
        return;
      }
      const d = param.seriesData?.get(candleSeries);
      if (d && Number.isFinite(d.close)) {
        setVelaHover(d);
      }
    };

    const handleClick = (param) => {
      const tool = herramientaRef.current;
      const datos = datosRef.current;
      if (!tool || !param?.point || !datos.length) return;
      const precio = candleSeries.coordinateToPrice(param.point.y);
      if (precio === null || !Number.isFinite(precio)) return;

      let tiempo = param.time ?? chart.timeScale().coordinateToTime(param.point.x);
      if (tiempo === null || tiempo === undefined) {
        const idxLog = chart.timeScale().coordinateToLogical(param.point.x);
        if (idxLog !== null && Number.isFinite(idxLog)) {
          const idx = Math.max(0, Math.min(datos.length - 1, Math.round(idxLog)));
          tiempo = datos[idx].time;
        }
      }
      if (tiempo === null || tiempo === undefined) return;

      if (tool === 'horizontal') {
        onAgregarDibujoRef.current?.({
          id: `${Date.now()}_h`,
          tipo: 'horizontal',
          p1: { time: datos[0].time, value: precio },
          p2: { time: datos[datos.length - 1].time, value: precio },
        });
        return;
      }

      const prev = primerPuntoRef.current;
      if (!prev) {
        setPrimerPunto({ time: tiempo, value: precio });
        return;
      }
      if (prev.time === tiempo) return;
      const [p1, p2] =
        prev.time < tiempo
          ? [prev, { time: tiempo, value: precio }]
          : [{ time: tiempo, value: precio }, prev];
      setPrimerPunto(null);
      onAgregarDibujoRef.current?.({
        id: `${Date.now()}_${tool}`,
        tipo: tool,
        p1,
        p2,
      });
    };

    chart.subscribeCrosshairMove(handleCrosshair);
    chart.subscribeClick(handleClick);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) {
          chart.applyOptions({ width });
        }
      }
    });
    ro.observe(el);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.unsubscribeClick(handleClick);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      positionPrimitiveRef.current = null;
      analisisSeriesRef.current = [];
      analisisPriceLinesRef.current = [];
      entryPriceLineRef.current = null;
      userSeriesRef.current = [];
    };
  }, [altura, hasCandles]);

  // 2. Actualizar velas + volumen cuando cambian `velasData`
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volSeries = volSeriesRef.current;
    const rawCandles = velasData?.candles;
    if (!chart || !candleSeries || !volSeries || !Array.isArray(rawCandles) || rawCandles.length === 0) {
      return;
    }

    const datos = rawCandles
      .map((c) => ({
        time: Number(c.t),
        open: Number(c.o),
        high: Number(c.h),
        low: Number(c.l),
        close: Number(c.c),
        volume: Number(c.v || 0),
      }))
      .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
      .sort((a, b) => a.time - b.time);

    if (!datos.length) return;
    datosRef.current = datos;

    const ultima = datos[datos.length - 1];
    setVelaHover(ultima);

    const refPrice = ultima.close;
    let precision = 1;
    let minMove = 0.1;
    if (refPrice < 10) {
      precision = 4;
      minMove = 0.0001;
    } else if (refPrice < 1000) {
      precision = 2;
      minMove = 0.01;
    }

    candleSeries.applyOptions({
      priceFormat: { type: 'price', precision, minMove },
    });
    candleSeries.setData(datos);

    volSeries.setData(
      datos.map((d, i) => {
        const volBase = d.volume > 0 ? d.volume : Math.abs(d.high - d.low) * 10 + ((i * 17) % 30) + 10;
        const sube = d.close >= d.open;
        return {
          time: d.time,
          value: volBase,
          color: sube ? 'rgba(34, 197, 94, 0.28)' : 'rgba(239, 68, 68, 0.28)',
        };
      })
    );

    const assetTfKey = `${velasData?.asset || ''}_${velasData?.tf || ''}`;
    if (prevAssetTfRef.current !== assetTfKey) {
      prevAssetTfRef.current = assetTfKey;
      closedMarkerTimeRef.current = null;
      prevPosStateRef.current = { had: false, asset: velasData?.asset || null };
      chart.timeScale().fitContent();
    }
  }, [velasData, altura, hasCandles]);

  // 3. Dibujar capas de estrategia (Chartismo / otras) + Posición abierta (Series Primitive)
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const posPrimitive = positionPrimitiveRef.current;
    const datos = datosRef.current;
    if (!chart || !candleSeries || !posPrimitive || !datos.length) return;

    // Limpiar todo lo dibujado anteriormente antes de redibujar (cero líneas fantasma)
    for (const s of analisisSeriesRef.current) {
      try {
        chart.removeSeries(s);
      } catch {}
    }
    analisisSeriesRef.current = [];

    for (const pl of analisisPriceLinesRef.current) {
      try {
        candleSeries.removePriceLine(pl);
      } catch {}
    }
    analisisPriceLinesRef.current = [];

    if (entryPriceLineRef.current) {
      try {
        candleSeries.removePriceLine(entryPriceLineRef.current);
      } catch {}
      entryPriceLineRef.current = null;
    }
    posPrimitive.setData(null);
    candleSeries.setMarkers([]);

    const ultima = datos[datos.length - 1];
    const refPrice = ultima.close;
    const prec = refPrice < 1 ? 4 : refPrice < 100 ? 2 : 1;

    const analisisCoincide = Boolean(
      mostrarDibujo &&
        analisis &&
        (!analisis.asset || analisis.asset === velasData?.asset) &&
        (!analisis.tf || analisis.tf === velasData?.tf)
    );
    const estrategiaNorm = String(analisis?.estrategia || '').toUpperCase();
    const esChartismo = analisisCoincide && estrategiaNorm === 'CHARTISMO';

    const markers = [];

    try {
      // Series continuas (EMAs, Bollinger, Supertrend, etc.)
      if (analisisCoincide && Array.isArray(analisis?.series)) {
        for (const s of analisis.series) {
          if (!Array.isArray(s.puntos) || s.puntos.length === 0 || s.panel === 'rsi') continue;
          const lineS = chart.addLineSeries({
            color: s.color || '#8B5CF6',
            lineWidth: Number(s.ancho || 2),
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          });
          const pts = dedupSortPoints(
            s.puntos.map((p) => ({
              time: Number(p.t),
              value: Number(p.v),
            }))
          );
          if (pts.length > 0) {
            lineS.setData(pts);
            analisisSeriesRef.current.push(lineS);
          } else {
            chart.removeSeries(lineS);
          }
        }
      }

      // A) Chartismo: solo cuando bot/analisis.estrategia == 'CHARTISMO'
      if (esChartismo) {
        const lineasList = Array.isArray(analisis.lineas) ? analisis.lineas : [];
        for (const l of lineasList) {
          const t1 = Number(l.t1);
          const p1 = Number(l.p1);
          const t2 = Number(l.t2);
          const p2 = Number(l.p2);
          if (![t1, p1, t2, p2].every(Number.isFinite) || t1 === t2) continue;
          const seg = chart.addLineSeries({
            color: l.color || '#EF4444',
            lineWidth: Number(l.ancho || 2),
            lineStyle: mapLineStyle(l.estilo),
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          });
          const pts = [
            { time: t1, value: p1 },
            { time: t2, value: p2 },
          ].sort((a, b) => a.time - b.time);
          seg.setData(pts);
          analisisSeriesRef.current.push(seg);
        }

        // Pivotes H/L con setMarkers (círculo morado y texto H o L)
        const marcadoresList = Array.isArray(analisis.marcadores) ? analisis.marcadores : [];
        for (const m of marcadoresList) {
          const tRaw = Number(m.t);
          if (!Number.isFinite(tRaw)) continue;
          const snapped = findBarForTime(tRaw, datos);
          const markerTime = snapped ? snapped.time : tRaw;
          const pos = m.posicion === 'abajo' ? 'belowBar' : m.posicion === 'arriba' ? 'aboveBar' : 'inBar';
          const shape =
            m.forma === 'flecha_arriba'
              ? 'arrowUp'
              : m.forma === 'flecha_abajo'
                ? 'arrowDown'
                : 'circle';
          markers.push({
            time: markerTime,
            position: pos,
            color: m.color || '#8B5CF6',
            shape,
            text: String(m.texto || ''),
          });
        }

        // Niveles de gatillo/objetivo como líneas horizontales punteadas con etiqueta pequeña
        const nivelesList = Array.isArray(analisis.niveles) ? analisis.niveles : [];
        for (const nv of nivelesList) {
          const nombreRaw = String(nv.nombre || '').trim();
          if (/^(entrada\b|tp\b|sl\b)/i.test(nombreRaw)) continue;
          const nombreCorto = nombreRaw.replace(/\s*\([^)]*\)\s*/g, '').trim() || nombreRaw;
          const precio = Number(nv.precio);
          if (!Number.isFinite(precio)) continue;
          const pl = candleSeries.createPriceLine({
            price: precio,
            color: nv.color || '#8B5CF6',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: nombreCorto.slice(0, 22),
          });
          analisisPriceLinesRef.current.push(pl);
        }
      }
    } catch (err) {
      console.error('Error dibujando análisis en BotCandlesChart:', err);
    }

    // B) Posición abierta (cualquier estrategia, si position.asset coincide con velasData.asset)
    const entryNum = Number(position?.entry);
    const tpNum = Number(position?.tp);
    const slNum = Number(position?.sl);
    const posValida = Boolean(
      position &&
        position.asset === velasData?.asset &&
        Number.isFinite(entryNum) &&
        entryNum > 0 &&
        Number.isFinite(tpNum) &&
        Number.isFinite(slNum)
    );

    if (posValida) {
      const side = String(position.side || 'LONG').toUpperCase();
      const posStrat = String(position.strategy || '').trim();
      const stratTag = posStrat ? ` (${posStrat.slice(0, 12)})` : '';
      prevPosStateRef.current = { had: true, asset: velasData?.asset || null };
      closedMarkerTimeRef.current = null;

      entryPriceLineRef.current = candleSeries.createPriceLine({
        price: entryNum,
        color: '#EDEDF0',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Entrada ${side}${stratTag}`.slice(0, 26),
      });

      const entrySec = parseEntryTimeSec(position) ?? ultima.time;
      const barInfo = findBarForTime(entrySec, datos) || { index: datos.length - 1, time: ultima.time, barsBeforeFirst: 0 };

      posPrimitive.setData({
        side,
        entry: entryNum,
        tp: tpNum,
        sl: slNum,
        prec,
        entryTime: barInfo.time,
        firstTime: datos[0].time,
        lastTime: ultima.time,
        barsBeforeFirst: barInfo.barsBeforeFirst,
        fallbackStartLogical: barInfo.index,
        fallbackLastLogical: datos.length - 1,
      });

      // Flecha en la vela de entrada (verde arriba si LONG, roja abajo si SHORT)
      markers.push({
        time: barInfo.time,
        position: side === 'SHORT' ? 'aboveBar' : 'belowBar',
        color: side === 'SHORT' ? '#EF4444' : '#22C55E',
        shape: side === 'SHORT' ? 'arrowDown' : 'arrowUp',
        text: '',
      });
    } else {
      if (
        prevPosStateRef.current.had &&
        prevPosStateRef.current.asset === velasData?.asset
      ) {
        closedMarkerTimeRef.current = ultima.time;
      }
      prevPosStateRef.current = { had: false, asset: velasData?.asset || null };

      if (closedMarkerTimeRef.current) {
        markers.push({
          time: closedMarkerTimeRef.current,
          position: 'aboveBar',
          color: '#94A3B8',
          shape: 'circle',
          text: 'Cerrada',
        });
      }
    }

    if (markers.length > 0) {
      markers.sort((a, b) => a.time - b.time);
      candleSeries.setMarkers(markers);
    }
  }, [velasData, position, analisis, mostrarDibujo, altura, hasCandles]);

  // 4. Dibujos manuales del usuario
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of userSeriesRef.current) {
      try {
        chart.removeSeries(s);
      } catch {}
    }
    userSeriesRef.current = [];

    for (const d of dibujosUsuario || []) {
      if (!d?.p1 || !d?.p2 || d.p1.time === d.p2.time) continue;
      const [a, b] = d.p1.time < d.p2.time ? [d.p1, d.p2] : [d.p2, d.p1];

      if (d.tipo === 'fib') {
        const niveles = [0, 0.382, 0.5, 0.618, 1];
        for (const nv of niveles) {
          const val = a.value + (b.value - a.value) * nv;
          const s = chart.addLineSeries({
            color: '#A78BFA',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          });
          s.setData([
            { time: a.time, value: val },
            { time: b.time, value: val },
          ]);
          userSeriesRef.current.push(s);
        }
      } else if (d.tipo === 'zona') {
        for (const val of [a.value, b.value]) {
          const s = chart.addLineSeries({
            color: '#60A5FA',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          });
          s.setData([
            { time: a.time, value: val },
            { time: b.time, value: val },
          ]);
          userSeriesRef.current.push(s);
        }
      } else {
        const s = chart.addLineSeries({
          color: '#C4B5FD',
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData([
          { time: a.time, value: a.value },
          { time: b.time, value: b.value },
        ]);
        userSeriesRef.current.push(s);
      }
    }
  }, [dibujosUsuario, velasData, analisis, mostrarDibujo]);

  if (!velasData || !Array.isArray(velasData.candles) || velasData.candles.length === 0) {
    return (
      <div className="bot-chart-empty">
        Cargando gráfico de velas en vivo...
      </div>
    );
  }

  const symTexto = String(velasData.asset || 'BTC_USDT').replace('_', '/');
  const tfTexto = String(velasData.tf || '5m');
  const v = velaHover || {};
  const chgVela =
    Number.isFinite(v.open) && v.open > 0
      ? ((v.close - v.open) / v.open) * 100
      : 0;
  const subeVela = chgVela >= 0;

  const mostrarResumenChartismo = Boolean(
    mostrarDibujo &&
      analisis &&
      (!analisis.asset || analisis.asset === velasData?.asset) &&
      (!analisis.tf || analisis.tf === velasData?.tf) &&
      String(analisis.estrategia || '').toUpperCase() === 'CHARTISMO' &&
      analisis.resumen
  );

  return (
    <div className="bot-chart-wrapper" style={{ position: 'relative' }}>
      <div className="chart-ohlc-overlay num">
        <span className="ohlc-sym">{symTexto} · {tfTexto}</span>
        <span>O {fmtNumPrice(v.open)}</span>
        <span>H {fmtNumPrice(v.high)}</span>
        <span>L {fmtNumPrice(v.low)}</span>
        <span>C {fmtNumPrice(v.close)}</span>
        <span className={subeVela ? 'text-green' : 'text-red'}>
          {subeVela ? '+' : ''}{chgVela.toFixed(2)}%
        </span>
      </div>
      <div
        ref={containerRef}
        className="bot-chart-canvas"
        style={{
          height: `${altura}px`,
          cursor: herramienta ? 'crosshair' : 'default',
        }}
      />
      {mostrarResumenChartismo && (
        <div className="bot-chart-resumen" role="note" aria-label="Resumen de chartismo">
          <span className="bot-chart-resumen-badge">Chartismo</span>
          <span className="bot-chart-resumen-text num">{analisis.resumen}</span>
        </div>
      )}
    </div>
  );
}
