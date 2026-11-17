import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';

export default function ChartismoCanvas({
  escenario,
  revelado = false,
  altura = 380,
  herramienta = null,
  lineasUsuario = [],
  onAgregarLinea,
  dibujoHabilitado = false,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const userSeriesRef = useRef([]);
  const [primerPunto, setPrimerPunto] = useState(null);

  // Refs para acceder al estado actual dentro del listener de clic sin recrear la gráfica
  const herramientaRef = useRef(herramienta);
  herramientaRef.current = herramienta;
  const dibujoHabilitadoRef = useRef(dibujoHabilitado);
  dibujoHabilitadoRef.current = dibujoHabilitado;
  const primerPuntoRef = useRef(primerPunto);
  primerPuntoRef.current = primerPunto;
  const onAgregarLineaRef = useRef(onAgregarLinea);
  onAgregarLineaRef.current = onAgregarLinea;

  // Reiniciar punto intermedio si cambia la herramienta, el escenario o se deshabilita el dibujo
  useEffect(() => {
    setPrimerPunto(null);
  }, [herramienta, escenario, dibujoHabilitado]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !escenario) return undefined;

    const chart = createChart(el, {
      width: el.clientWidth || 640,
      height: altura,
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e14' },
        textColor: '#93a0b8',
        fontFamily: "'Inter', sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(37, 45, 64, 0.45)' },
        horzLines: { color: 'rgba(37, 45, 64, 0.45)' },
      },
      rightPriceScale: {
        borderColor: '#252d40',
        scaleMargins: { top: 0.14, bottom: 0.14 },
      },
      timeScale: {
        borderColor: '#252d40',
        timeVisible: false,
        rightOffset: 3,
      },
      crosshair: {
        vertLine: { color: 'rgba(59, 130, 246, 0.4)' },
        horzLine: { color: 'rgba(59, 130, 246, 0.4)' },
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c58b',
      downColor: '#f0506e',
      borderUpColor: '#22c58b',
      borderDownColor: '#f0506e',
      wickUpColor: '#22c58b',
      wickDownColor: '#f0506e',
      priceFormat: {
        type: 'price',
        precision: escenario.precision ?? 2,
        minMove: escenario.minMove ?? 0.01,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    userSeriesRef.current = [];

    const velasAMostrar = revelado ? escenario.todasLasVelas : escenario.velasFormacion;
    candleSeries.setData(velasAMostrar);

    if (revelado) {
      for (const lin of escenario.lineasEscaladas || []) {
        const lineSeries = chart.addLineSeries({
          color: lin.color,
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        lineSeries.setData(lin.datos);
      }

      if (escenario.marcadorRuptura) {
        candleSeries.setMarkers([escenario.marcadorRuptura]);
      }
    } else {
      candleSeries.setMarkers([]);
    }

    const handleClick = (param) => {
      if (!dibujoHabilitadoRef.current || !herramientaRef.current) return;
      if (!param?.point || !velasAMostrar?.length) return;

      const precio = candleSeries.coordinateToPrice(param.point.y);
      if (precio === null || !Number.isFinite(precio)) return;

      let tiempo = param.time ?? chart.timeScale().coordinateToTime(param.point.x);
      if (tiempo === null || tiempo === undefined) {
        const idxLog = chart.timeScale().coordinateToLogical(param.point.x);
        if (idxLog !== null && Number.isFinite(idxLog)) {
          const idx = Math.max(0, Math.min(velasAMostrar.length - 1, Math.round(idxLog)));
          tiempo = velasAMostrar[idx].time;
        }
      }
      if (tiempo === null || tiempo === undefined) return;

      if (herramientaRef.current === 'horizontal') {
        const tIni = velasAMostrar[0].time;
        const tFin = velasAMostrar[velasAMostrar.length - 1].time;
        onAgregarLineaRef.current?.({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          tipo: 'horizontal',
          p1: { time: tIni, value: precio },
          p2: { time: tFin, value: precio },
        });
        return;
      }

      if (herramientaRef.current === 'tendencia') {
        const prev = primerPuntoRef.current;
        if (!prev) {
          setPrimerPunto({ time: tiempo, value: precio });
          return;
        }
        if (tiempo === prev.time) {
          return;
        }
        const [p1, p2] =
          prev.time < tiempo
            ? [prev, { time: tiempo, value: precio }]
            : [{ time: tiempo, value: precio }, prev];
        setPrimerPunto(null);
        onAgregarLineaRef.current?.({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          tipo: 'tendencia',
          p1,
          p2,
        });
      }
    };

    chart.subscribeClick(handleClick);
    chart.timeScale().fitContent();

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
      chart.unsubscribeClick(handleClick);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      userSeriesRef.current = [];
    };
  }, [escenario, revelado, altura]);

  // Dibujar / actualizar líneas del usuario en blanco sin reiniciar la gráfica
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const s of userSeriesRef.current) {
      try {
        chart.removeSeries(s);
      } catch {
        // ignorar si la gráfica ya fue desmontada
      }
    }
    userSeriesRef.current = [];

    for (const lin of lineasUsuario || []) {
      if (!lin?.p1 || !lin?.p2 || lin.p1.time === lin.p2.time) continue;
      const [a, b] = lin.p1.time < lin.p2.time ? [lin.p1, lin.p2] : [lin.p2, lin.p1];
      const userSeries = chart.addLineSeries({
        color: '#ffffff',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      userSeries.setData([
        { time: a.time, value: Number(a.value) },
        { time: b.time, value: Number(b.value) },
      ]);
      userSeriesRef.current.push(userSeries);
    }
  }, [lineasUsuario, escenario, revelado]);

  return (
    <div className="chartismo-canvas-wrap">
      <div
        ref={containerRef}
        className={`chartismo-canvas ${dibujoHabilitado && herramienta ? 'drawing-active' : ''}`}
        style={{ height: `${altura}px`, cursor: dibujoHabilitado && herramienta ? 'crosshair' : 'default' }}
      />
      {dibujoHabilitado && herramienta === 'tendencia' && primerPunto && (
        <div className="chartismo-draw-hint">
          Primer punto fijado. Haz clic en el segundo punto para trazar la línea de tendencia.
        </div>
      )}
      {revelado && (
        <div className="chartismo-legend">
          <span className="legend-item">
            <span className="legend-line resistencia" /> Resistencia
          </span>
          <span className="legend-item">
            <span className="legend-line soporte" /> Soporte
          </span>
          <span className="legend-item">
            <span className="legend-line cuello" /> Cuello / Nivel clave
          </span>
          <span className="legend-item">
            <span className="legend-line fibonacci" /> Fibonacci (38.2% · 50% · 61.8%)
          </span>
          {lineasUsuario?.length > 0 && (
            <span className="legend-item">
              <span className="legend-line usuario" /> Tu dibujo
            </span>
          )}
        </div>
      )}
    </div>
  );
}
