import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Check, ChevronRight, Layers, RotateCcw, Sparkles } from 'lucide-react';
import { CATALOGO_ACTIVOS, MAPA_ACTIVOS } from '../data/catalogo';
import { COMISION } from '../config/tradingConfig';
import {
  SALDO_INICIAL,
  solicitarPortafolioML,
  obtenerPortafolioML,
  consultarGemini,
  ejecutarOperacionUsuario,
  invertirCarteraPortafolioUsuario,
} from '../services/firebase';
import {
  normalizarPortafoliosInvertidos,
  obtenerSiguienteNumeroPortafolio,
  calcularSeguimientoPortafolios,
} from '../utils/portafoliosGuardados';
import MisPortafoliosInvertidos from './MisPortafoliosInvertidos';

const COLORES_DONA = [
  '#8B5CF6',
  '#22C55E',
  '#3B82F6',
  '#EAB308',
  '#EF4444',
  '#06B6D4',
  '#F97316',
  '#EC4899',
];

function fmtNum(val, dec = 2) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtSignedPct(val, dec = 2) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '0.00%';
  return `${n > 0 ? '+' : ''}${fmtNum(n, dec)}%`;
}

function obtenerMejorModelo(modelos = [], mejorRef) {
  if (!Array.isArray(modelos) || modelos.length === 0) {
    return { idx: 0, fila: null };
  }
  if (typeof mejorRef === 'number' && modelos[mejorRef]) {
    return { idx: mejorRef, fila: modelos[mejorRef] };
  }
  if (typeof mejorRef === 'string') {
    const idx = modelos.findIndex(
      (m) => String(m.modelo || '').toLowerCase() === mejorRef.toLowerCase()
    );
    if (idx >= 0) return { idx, fila: modelos[idx] };
  }
  return { idx: 0, fila: modelos[0] };
}

const CLASES_VOLATILIDAD = ['baja', 'media', 'alta'];

const NOTA_EXPLICACION_DM =
  'DM > 0 y p < 0.05 = el modelo es significativamente PEOR que el ingenuo; DM < 0 y p < 0.05 = significativamente MEJOR que el ingenuo; p ≥ 0.05 = sin diferencia estadísticamente significativa.';

function fmtF1Clase(f1PorClase, clase) {
  const v = f1PorClase?.[clase];
  return v != null && Number.isFinite(Number(v)) ? fmtNum(v, 3) : '—';
}

function obtenerMapeSmapeModelo(m) {
  const mape =
    m?.mape != null && Number.isFinite(Number(m.mape)) ? Number(m.mape) : null;
  const smape =
    m?.smape != null && Number.isFinite(Number(m.smape)) ? Number(m.smape) : null;
  return { mape, smape };
}

function claseVeredictoDM(dm, p) {
  const d = Number(dm);
  const pv = Number(p);
  if (Number.isFinite(d) && Number.isFinite(pv) && pv < 0.05) {
    if (d < 0) return 'good';
    if (d > 0) return 'bad';
  }
  return 'neutral';
}

function fraseVeredictoDM(dm, p) {
  const d = Number(dm);
  const pv = Number(p);
  if (Number.isFinite(d) && Number.isFinite(pv) && pv < 0.05) {
    if (d < 0) return 'Significativamente MEJOR que el ingenuo';
    if (d > 0) return 'Significativamente PEOR que el ingenuo';
  }
  return 'Sin diferencia significativa frente al ingenuo';
}

function construirMatrizPearson(pesos = [], remoteCorr = null) {
  if (!remoteCorr || typeof remoteCorr !== 'object') return null;
  const items = pesos.slice(0, 10).filter((it) => remoteCorr[it.sym]);
  if (items.length < 2) return null;

  let sumOff = 0;
  let countOff = 0;
  const matrix = items.map((rowItem, i) =>
    items.map((colItem, j) => {
      const raw =
        remoteCorr?.[rowItem.sym]?.[colItem.sym] ??
        remoteCorr?.[colItem.sym]?.[rowItem.sym];
      const val = Number.isFinite(Number(raw)) ? Number(raw) : i === j ? 1.0 : 0.0;
      if (i !== j) {
        sumOff += val;
        countOff += 1;
      }
      return val;
    })
  );

  return {
    items,
    matrix,
    promedio: countOff > 0 ? sumOff / countOff : 0,
  };
}

function construirPortafolioInicial(
  perfilRiesgo = 'conservador',
  capital = 1000,
  anios = 5,
  maxPeso = 0.35
) {
  const cap = Math.max(100, Number(capital || 1000));
  const preciosDemo = {
    TLT: 92.4,
    MSFT: 523.88,
    JPM: 242.15,
    META: 592.3,
    BTC_USDT: 63904.6,
  };
  const armarPesos = (lista) =>
    lista.map((it) => {
      const px = preciosDemo[it.sym] || 100;
      const monto = cap * it.peso;
      return {
        ...it,
        monto,
        precio: px,
        cantidad: monto / px,
      };
    });

  const pesosMinVar = armarPesos([
    { sym: 'TLT', nombre: 'Bonos Tesoro 20+', clase: 'ETF', peso: 0.35, regimen: 'baja' },
    { sym: 'MSFT', nombre: 'Microsoft', clase: 'STOCK', peso: 0.325, regimen: 'baja' },
    { sym: 'JPM', nombre: 'JPMorgan', clase: 'STOCK', peso: 0.212, regimen: 'media' },
    { sym: 'META', nombre: 'Meta', clase: 'STOCK', peso: 0.063, regimen: 'media' },
    { sym: 'BTC_USDT', nombre: 'Bitcoin', clase: 'CRYPTO', peso: 0.05, regimen: 'alta' },
  ]);
  const pesosSharpe = armarPesos([
    { sym: 'MSFT', nombre: 'Microsoft', clase: 'STOCK', peso: 0.35, regimen: 'baja' },
    { sym: 'TLT', nombre: 'Bonos Tesoro 20+', clase: 'ETF', peso: 0.28, regimen: 'baja' },
    { sym: 'JPM', nombre: 'JPMorgan', clase: 'STOCK', peso: 0.19, regimen: 'media' },
    { sym: 'META', nombre: 'Meta', clase: 'STOCK', peso: 0.11, regimen: 'media' },
    { sym: 'BTC_USDT', nombre: 'Bitcoin', clase: 'CRYPTO', peso: 0.07, regimen: 'alta' },
  ]);
  const pesosParidad = armarPesos([
    { sym: 'TLT', nombre: 'Bonos Tesoro 20+', clase: 'ETF', peso: 0.34, regimen: 'baja' },
    { sym: 'MSFT', nombre: 'Microsoft', clase: 'STOCK', peso: 0.26, regimen: 'baja' },
    { sym: 'JPM', nombre: 'JPMorgan', clase: 'STOCK', peso: 0.22, regimen: 'media' },
    { sym: 'META', nombre: 'Meta', clase: 'STOCK', peso: 0.11, regimen: 'media' },
    { sym: 'BTC_USDT', nombre: 'Bitcoin', clase: 'CRYPTO', peso: 0.07, regimen: 'alta' },
  ]);
  const pesosIguales = armarPesos([
    { sym: 'TLT', nombre: 'Bonos Tesoro 20+', clase: 'ETF', peso: 0.2, regimen: 'baja' },
    { sym: 'MSFT', nombre: 'Microsoft', clase: 'STOCK', peso: 0.2, regimen: 'baja' },
    { sym: 'JPM', nombre: 'JPMorgan', clase: 'STOCK', peso: 0.2, regimen: 'media' },
    { sym: 'META', nombre: 'Meta', clase: 'STOCK', peso: 0.2, regimen: 'media' },
    { sym: 'BTC_USDT', nombre: 'Bitcoin', clase: 'CRYPTO', peso: 0.2, regimen: 'alta' },
  ]);

  const pesosRec =
    perfilRiesgo === 'conservador'
      ? pesosMinVar
      : perfilRiesgo === 'agresivo'
        ? pesosSharpe
        : pesosParidad;

  const metricasRec =
    perfilRiesgo === 'conservador'
      ? {
          descripcion: 'Minimiza las fluctuaciones diarias excluyendo activos en régimen alto.',
          rendimiento: 2.25,
          volatilidad: 11.81,
          sharpe: -0.16,
          sortino: 0.45,
          var95_dia: 1.13,
          cvar95_dia: 1.54,
        }
      : perfilRiesgo === 'agresivo'
        ? {
            descripcion: 'Maximiza la relación rendimiento/riesgo (Sharpe) con señales ML.',
            rendimiento: 12.28,
            volatilidad: 15.25,
            sharpe: 0.54,
            sortino: 0.92,
            var95_dia: 1.45,
            cvar95_dia: 1.98,
          }
        : {
            descripcion: 'Equilibra el aporte de riesgo de cada activo limitando régimen alto a 10%.',
            rendimiento: 8.29,
            volatilidad: 13.99,
            sharpe: 0.3,
            sortino: 0.79,
            var95_dia: 1.34,
            cvar95_dia: 1.81,
          };

  return {
    id: 'demo_init',
    perfil: perfilRiesgo,
    capital: cap,
    anios,
    max_peso: maxPeso,
    tasa_libre: 4.2,
    mezcla_ml: 0.5,
    desde: '2021-11-14',
    hasta: '2026-11-14',
    dias: 1260,
    carteras: [
      {
        nombre: `Recomendada (${perfilRiesgo})`,
        ...metricasRec,
        pesos: pesosRec,
      },
      {
        nombre: 'Máximo Sharpe',
        descripcion: 'Mayor rendimiento esperado por cada punto de volatilidad asumida.',
        rendimiento: 12.28,
        volatilidad: 15.25,
        sharpe: 0.54,
        sortino: 0.92,
        var95_dia: 1.45,
        cvar95_dia: 1.98,
        pesos: pesosSharpe,
      },
      {
        nombre: 'Mínima varianza',
        descripcion: 'Combinación con la menor volatilidad anual posible en la frontera.',
        rendimiento: 2.25,
        volatilidad: 11.81,
        sharpe: -0.16,
        sortino: 0.45,
        var95_dia: 1.13,
        cvar95_dia: 1.54,
        pesos: pesosMinVar,
      },
      {
        nombre: 'Paridad de riesgo',
        descripcion: 'Cada activo aporta exactamente la misma proporción al riesgo total.',
        rendimiento: 8.29,
        volatilidad: 13.99,
        sharpe: 0.3,
        sortino: 0.79,
        var95_dia: 1.34,
        cvar95_dia: 1.81,
        pesos: pesosParidad,
      },
      {
        nombre: 'Pesos iguales (1/N)',
        descripcion: 'Reparte el capital en partes iguales entre todos los activos elegidos.',
        rendimiento: 10.97,
        volatilidad: 21.81,
        sharpe: 0.31,
        sortino: 1.08,
        var95_dia: 2.19,
        cvar95_dia: 2.95,
        pesos: pesosIguales,
      },
    ],
    frontera: [
      { volatilidad: 11.81, rendimiento: 2.25 },
      { volatilidad: 12.35, rendimiento: 4.9 },
      { volatilidad: 13.15, rendimiento: 6.7 },
      { volatilidad: 13.99, rendimiento: 8.29 },
      { volatilidad: 14.65, rendimiento: 10.4 },
      { volatilidad: 15.25, rendimiento: 12.28 },
      { volatilidad: 16.8, rendimiento: 13.45 },
      { volatilidad: 19.0, rendimiento: 14.5 },
      { volatilidad: 22.0, rendimiento: 15.25 },
      { volatilidad: 25.0, rendimiento: 15.65 },
    ],
    activos: [
      {
        sym: 'TLT',
        nombre: 'Bonos Tesoro 20+',
        clase: 'ETF',
        regimen: 'baja',
        prob_regimen: 0.78,
        rend_ml: 3.4,
        rend_hist: 2.8,
        rend_usado: 3.1,
        volatilidad: 14.2,
        tope: maxPeso,
      },
      {
        sym: 'MSFT',
        nombre: 'Microsoft',
        clase: 'STOCK',
        regimen: 'baja',
        prob_regimen: 0.71,
        rend_ml: 15.6,
        rend_hist: 14.0,
        rend_usado: 14.8,
        volatilidad: 22.4,
        tope: maxPeso,
      },
      {
        sym: 'JPM',
        nombre: 'JPMorgan',
        clase: 'STOCK',
        regimen: 'media',
        prob_regimen: 0.64,
        rend_ml: 10.8,
        rend_hist: 11.6,
        rend_usado: 11.2,
        volatilidad: 21.1,
        tope: maxPeso,
      },
      {
        sym: 'META',
        nombre: 'Meta',
        clase: 'STOCK',
        regimen: 'media',
        prob_regimen: 0.59,
        rend_ml: 16.2,
        rend_hist: 14.6,
        rend_usado: 15.4,
        volatilidad: 28.5,
        tope: maxPeso,
      },
      {
        sym: 'BTC_USDT',
        nombre: 'Bitcoin',
        clase: 'CRYPTO',
        regimen: 'alta',
        prob_regimen: 0.82,
        rend_ml: 21.0,
        rend_hist: 28.0,
        rend_usado: 24.5,
        volatilidad: 46.0,
        tope: perfilRiesgo === 'conservador' ? 0 : perfilRiesgo === 'moderado' ? 0.1 : maxPeso,
      },
    ],
    fuera_de_muestra: {
      desde: '2025-05-01',
      hasta: '2026-11-14',
      sharpe_con_ml: 18.4,
      sharpe_historico: 14.2,
      minima_varianza: 7.8,
      paridad_riesgo: 11.6,
      pesos_iguales: 12.9,
      spy: 15.1,
    },
    backtest: {
      sharpe_ml: 0.61,
      sharpe_hist: 0.48,
      sharpe_minvar: 0.22,
      sharpe_1n: 0.35,
      sharpe_spy: 0.52,
    },
    ml: {
      n_train: 882,
      n_test: 378,
      corte: '2025-05-01',
      horizonte_dias: 20,
      temporalidad: 'diaria',
      variables: ['ret_5d', 'ret_20d', 'vol_20d', 'vol_60d', 'rsi_14', 'dist_ma50', 'beta_spy'],
      regimen: {
        mejor: 'Random Forest',
        modelos: [
          { modelo: 'Random Forest', accuracy: 74.6, f1: 0.738, dm: -2.41, p: 0.016 },
          { modelo: 'KNN', accuracy: 69.8, f1: 0.684, dm: -1.12, p: 0.263 },
          { modelo: 'Red neuronal', accuracy: 72.1, f1: 0.711, dm: -1.85, p: 0.064 },
        ],
        base: {
          modelo: 'Ingenuo (el régimen de mañana = el de hoy)',
          accuracy: 68.2,
          f1: 0.665,
        },
        etiquetas: ['baja', 'media', 'alta'],
        matriz: [
          [112, 24, 4],
          [19, 108, 15],
          [3, 21, 72],
        ],
      },
      rendimiento: {
        mejor: 'Random Forest',
        modelos: [
          {
            modelo: 'Random Forest',
            rmse: 5.42,
            mse: 29.38,
            mae: 4.18,
            mape: 3.85,
            smape: 3.79,
            variance_score: 0.084,
            r2: 0.079,
            acierto_direccion: 58.2,
            dm: -2.14,
            p: 0.032,
          },
          {
            modelo: 'KNN',
            rmse: 5.89,
            mse: 34.69,
            mae: 4.52,
            mape: 4.21,
            smape: 4.15,
            variance_score: 0.012,
            r2: 0.005,
            acierto_direccion: 53.4,
            dm: -0.45,
            p: 0.652,
          },
          {
            modelo: 'Red neuronal',
            rmse: 5.61,
            mse: 31.47,
            mae: 4.31,
            mape: 3.98,
            smape: 3.92,
            variance_score: 0.051,
            r2: 0.044,
            acierto_direccion: 56.1,
            dm: -1.58,
            p: 0.114,
          },
        ],
        base: {
          modelo: 'Ingenuo (promedio histórico)',
          rmse: 5.78,
          mse: 33.41,
          mae: 4.44,
          mape: 4.12,
          smape: 4.06,
          variance_score: 0.0,
        },
        etiquetas_direccion: ['baja', 'sube'],
        matriz_direccion: [
          [94, 72],
          [86, 126],
        ],
      },
    },
  };
}

function firmaPesosCartera(c) {
  return [...(c?.pesos || [])]
    .filter((p) => Number(p.peso || 0) > 0.001)
    .sort((a, b) => String(a.sym).localeCompare(String(b.sym)))
    .map((p) => `${p.sym}:${Number(p.peso || 0).toFixed(3)}`)
    .join('|');
}

const PASOS_ASISTENTE = [
  { id: 0, corto: 'Configura', nombre: 'Configura tu cartera' },
  { id: 1, corto: 'Riesgo', nombre: 'Clasificamos el riesgo' },
  { id: 2, corto: 'Rendimiento', nombre: 'Estimamos el rendimiento' },
  { id: 3, corto: 'Optimización', nombre: 'Optimizamos tu cartera' },
];

function useCountUp(target, active, durationMs = 600) {
  const numericTarget = Number(target || 0);
  const [val, setVal] = useState(numericTarget);

  useEffect(() => {
    if (!active || !Number.isFinite(numericTarget)) {
      setVal(numericTarget);
      return undefined;
    }
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setVal(numericTarget);
      return undefined;
    }
    let rafId = 0;
    const t0 = performance.now();
    setVal(0);
    const tick = (now) => {
      const progreso = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - progreso, 3);
      setVal(numericTarget * eased);
      if (progreso < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setVal(numericTarget);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [numericTarget, active, durationMs]);

  return val;
}

function MatrizConfusion({
  titulo,
  subtitulo,
  etiquetas,
  matriz,
  cols2 = false,
  prefix = 'm',
}) {
  if (!Array.isArray(matriz) || matriz.length === 0) return null;

  const n = etiquetas.length;
  const sumasFilas = etiquetas.map((_, rIdx) =>
    (matriz[rIdx] || []).reduce((acc, v) => acc + Number(v || 0), 0)
  );
  const sumasCols = etiquetas.map((_, cIdx) =>
    matriz.reduce((acc, fila) => acc + Number(fila?.[cIdx] || 0), 0)
  );
  const totalCasos = sumasFilas.reduce((a, b) => a + b, 0);
  const totalAciertos = etiquetas.reduce(
    (acc, _, idx) => acc + Number(matriz[idx]?.[idx] || 0),
    0
  );
  const pctAciertoTotal = totalCasos > 0 ? (totalAciertos / totalCasos) * 100 : 0;

  let idxColMax = 0;
  for (let i = 1; i < n; i++) {
    if (sumasCols[i] > sumasCols[idxColMax]) idxColMax = i;
  }
  const pctColDominante =
    totalCasos > 0 ? Math.round((sumasCols[idxColMax] / totalCasos) * 100) : 0;
  const etiquetaDominante = etiquetas[idxColMax] || '';

  return (
    <div className="cm-human-block" style={{ marginTop: '12px' }}>
      <div className="ml-side-head" style={{ marginBottom: '6px' }}>
        <strong style={{ fontSize: '12.5px' }}>{titulo}</strong>
        <span className="ml-side-sub">{subtitulo}</span>
      </div>

      <div className="cm-human-summary">
        <span>
          <strong>¿Cómo se lee esta tabla?</strong> Compara lo que{' '}
          <strong>pasó en la realidad</strong> (filas) contra lo que{' '}
          <strong>predijo la IA</strong> (columnas). De{' '}
          <strong className="num">{totalCasos.toLocaleString('en-US')}</strong> casos de
          prueba, la IA acertó en{' '}
          <strong className="num">{totalAciertos.toLocaleString('en-US')}</strong> (
          <strong className="num">{fmtNum(pctAciertoTotal, 1)}%</strong>, cuadros con{' '}
          <span className="text-green">✓ Acertó</span>).
        </span>
        {pctColDominante >= 75 && (
          <span className="cm-bias-note">
            <strong>¿Por qué una columna tiene casi todos los casos?</strong> Como en el
            historial de largo plazo el mercado tiende a moverse hacia{' '}
            <strong>«{etiquetaDominante}»</strong>, el modelo aprendió a pronosticar{' '}
            <strong>«{etiquetaDominante}»</strong> el{' '}
            <strong className="num">{pctColDominante}%</strong> de las veces.
          </span>
        )}
      </div>

      <div className={`ml-cm-grid ${cols2 ? 'cols2' : ''}`}>
        <div className="ml-cm-corner">Real ↓ / IA →</div>
        {etiquetas.map((et) => (
          <div key={`${prefix}_col_${et}`} className="ml-cm-col-head">
            IA dijo: <strong>{et}</strong>
          </div>
        ))}
        {matriz.map((fila, rIdx) => {
          const rowSum = Math.max(1, sumasFilas[rIdx] || 0);
          const et = etiquetas[rIdx];
          return (
            <React.Fragment key={`${prefix}_r_${rIdx}`}>
              <div className="ml-cm-row-head">
                <span>
                  En realidad: <strong>{et}</strong>
                </span>
                <small className="cm-row-total num">
                  ({sumasFilas[rIdx].toLocaleString('en-US')} casos)
                </small>
              </div>
              {(fila || []).map((val, cIdx) => {
                const esDiag = rIdx === cIdx;
                const pct = Math.round((Number(val || 0) / rowSum) * 100);
                return (
                  <div
                    key={`${prefix}_c_${rIdx}_${cIdx}`}
                    className={`ml-cm-cell compact ${esDiag ? 'diag' : 'off'}`}
                  >
                    <span className={`cm-cell-tag ${esDiag ? 'hit' : 'miss'}`}>
                      {esDiag ? '✓ Acertó' : '✗ Confundió'}
                    </span>
                    <div className="cm-val-line">
                      <strong className="ml-cm-num num">
                        {Number(val || 0).toLocaleString('en-US')}
                      </strong>
                      <small className="cm-casos-lbl">casos</small>
                    </div>
                    <span className="ml-cm-pct">
                      <strong className="num">{pct}%</strong> de cuando fue {et}
                    </span>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function TarjetaCartera({
  c,
  idx,
  esTarjetaRec,
  esActiva,
  coincideNombre,
  animarCifras,
  onSelect,
}) {
  const rendObj = Number(c.rendimiento || 0);
  const volObj = Number(c.volatilidad || 0);
  const shObj = Number(c.sharpe || 0);
  const so = Number(c.sortino || 0);
  const var95 = Number(c.var95_dia || 0);
  const cvar95 = Number(c.cvar95_dia || var95 * 1.32);

  const rendVis = useCountUp(rendObj, esTarjetaRec && animarCifras, 600);
  const volVis = useCountUp(volObj, esTarjetaRec && animarCifras, 600);
  const shVis = useCountUp(shObj, esTarjetaRec && animarCifras, 600);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`portafolio-strategy-card ${esTarjetaRec ? 'recommended' : ''} ${
        esActiva ? 'selected' : ''
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
    >
      <div className="p-card-header">
        <strong className="p-card-title">{c.nombre}</strong>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {esTarjetaRec && (
            <span className="p-card-rec-badge">
              {coincideNombre ? `Coincide con ${coincideNombre}` : 'Recomendada'}
            </span>
          )}
          {esActiva && (
            <span className="p-card-rec-badge is-selected">Activa</span>
          )}
        </div>
      </div>

      <div className="p-card-metrics">
        <div className="p-metric-row">
          <span className="p-metric-lbl">
            Rendimiento esperado
            <small className="p-metric-hint">ganancia anual estimada</small>
          </span>
          <strong className={`p-metric-val num ${rendObj >= 0 ? 'text-green' : 'text-red'}`}>
            {fmtNum(rendVis, 2)}%
          </strong>
        </div>
        <div className="p-metric-row">
          <span className="p-metric-lbl">
            Volatilidad
            <small className="p-metric-hint">qué tanto sube/baja al año</small>
          </span>
          <strong className="p-metric-val num">{fmtNum(volVis, 2)}%</strong>
        </div>
        <div className="p-metric-row">
          <span className="p-metric-lbl">
            Sharpe
            <small className="p-metric-hint">ganancia por cada punto de riesgo</small>
          </span>
          <strong className={`p-metric-val num ${shObj < 0 ? 'text-red' : ''}`}>
            {fmtNum(shVis, 2)}
          </strong>
        </div>
        <div className="p-metric-row">
          <span className="p-metric-lbl">
            Sortino
            <small className="p-metric-hint">premio frente a caídas</small>
          </span>
          <strong className="p-metric-val num">{fmtNum(so, 2)}</strong>
        </div>
        <div className="p-metric-row">
          <span className="p-metric-lbl">
            VaR 95% día
            <small className="p-metric-hint">pérdida en 1 día malo (1 de 20)</small>
          </span>
          <strong className="p-metric-val num text-red">{fmtNum(var95, 2)}%</strong>
        </div>
        <div className="p-metric-row">
          <span className="p-metric-lbl">
            CVaR 95% día
            <small className="p-metric-hint">pérdida en el peor 5% de días</small>
          </span>
          <strong className="p-metric-val num text-red">{fmtNum(cvar95, 2)}%</strong>
        </div>
      </div>
    </div>
  );
}

export default function PortafolioMLView({
  uid,
  perfil,
  precios = {},
  resumenFinanciero = null,
  onSelectSeccion = null,
  onToast,
}) {
  const efectivo = Number(resumenFinanciero?.efectivo ?? perfil?.saldo ?? SALDO_INICIAL);

  // Controles de configuración completos (Sección 5.7)
  const [perfilSel, setPerfilSel] = useState(perfil?.perfil_riesgo || 'conservador');
  const [capitalStr, setCapitalStr] = useState('1000');
  const [anios, setAnios] = useState(5);
  const [maxPeso, setMaxPeso] = useState(0.35);
  const [modoActivos, setModoActivos] = useState('auto'); // 'auto' | 'manual'
  const [activosManuales, setActivosManuales] = useState([
    'SPY',
    'QQQ',
    'TLT',
    'GLD',
    'NVDA',
    'AAPL',
    'MSFT',
    'JPM',
    'META',
    'BTC_USDT',
  ]);

  const [calculando, setCalculando] = useState(false);
  const [errorCalc, setErrorCalc] = useState('');
  const [portafolioRemoto, setPortafolioRemoto] = useState(null);
  const [cargandoInicial, setCargandoInicial] = useState(false);
  const [carteraActivaIdx, setCarteraActivaIdx] = useState(0);
  const [activoHover, setActivoHover] = useState(null);

  // Estado del asistente por pasos (0 Configura, 1 Riesgo, 2 Rendimiento, 3 Optimización)
  const [pasoActual, setPasoActual] = useState(0);
  const [pasoDesbloqueado, setPasoDesbloqueado] = useState(0);
  const [verTodo, setVerTodo] = useState(false);
  const [reiniciadoManual, setReiniciadoManual] = useState(false);
  const [stickyTopPx, setStickyTopPx] = useState(44);

  const paso0Ref = useRef(null);
  const paso1Ref = useRef(null);
  const paso2Ref = useRef(null);
  const paso3Ref = useRef(null);
  const stepperTrackRef = useRef(null);
  const misPortafoliosRef = useRef(null);

  // Explicación IA (Gemini)
  const [analizandoIA, setAnalizandoIA] = useState(false);
  const [respuestaIA, setRespuestaIA] = useState('');

  // Inversión, Rebalanceo y múltiples portafolios con contexto
  const [modalInvertir, setModalInvertir] = useState(false);
  const [contextoInversion, setContextoInversion] = useState('');
  const [invirtiendo, setInvirtiendo] = useState(false);
  const [rebalanceandoId, setRebalanceandoId] = useState(null);
  const [misPortafoliosExpandido, setMisPortafoliosExpandido] = useState(true);
  const [justoInvirtioId, setJustoInvirtioId] = useState(null);

  useEffect(() => {
    if (!justoInvirtioId) return undefined;
    const t = setTimeout(() => setJustoInvirtioId(null), 1300);
    return () => clearTimeout(t);
  }, [justoInvirtioId]);

  const portafoliosGuardados = useMemo(
    () => normalizarPortafoliosInvertidos(perfil),
    [perfil]
  );

  const siguienteNumeroPortafolio = useMemo(
    () => obtenerSiguienteNumeroPortafolio(perfil),
    [perfil]
  );

  const seguimientoPortafolios = useMemo(
    () =>
      calcularSeguimientoPortafolios(
        portafoliosGuardados,
        perfil?.posiciones || {},
        precios
      ),
    [portafoliosGuardados, perfil?.posiciones, precios]
  );

  // Medir altura real del header (.navbar) para que el stepper sticky quede justo debajo en cualquier ancho
  useEffect(() => {
    const navEl = document.querySelector('.navbar');
    if (!navEl) return undefined;
    const actualizar = () => {
      const h = Math.round(navEl.getBoundingClientRect().height);
      if (h > 0) setStickyTopPx(h);
    };
    actualizar();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(actualizar);
    ro.observe(navEl);
    return () => ro.disconnect();
  }, []);

  const ultimoPortafolioId =
    portafoliosGuardados[portafoliosGuardados.length - 1]?.portafolioId ||
    perfil?.portafolioLargoPlazo?.portafolioId ||
    '';

  // Si ya existe un portafolio calculado (invertido o guardado en localStorage), entrar directo al Paso 1
  useEffect(() => {
    if (!uid || portafolioRemoto || reiniciadoManual) return undefined;
    let guardadoId = null;
    try {
      guardadoId = window.localStorage.getItem(`bolsalab_ultimo_portafolio_${uid}`);
    } catch {
      guardadoId = null;
    }
    const pid = ultimoPortafolioId || guardadoId;
    if (!pid) return undefined;

    let cancelado = false;
    setCargandoInicial(true);
    obtenerPortafolioML(pid)
      .then((docData) => {
        if (cancelado || !docData) return;
        setPortafolioRemoto(docData);
        setPasoActual(1);
        setPasoDesbloqueado((prev) => Math.max(prev, 1));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelado) setCargandoInicial(false);
      });
    return () => {
      cancelado = true;
    };
  }, [
    uid,
    ultimoPortafolioId,
    portafolioRemoto,
    reiniciadoManual,
  ]);

  const scrollSuaveAPaso = (stepIdx) => {
    const refs = [paso0Ref, paso1Ref, paso2Ref, paso3Ref];
    const target = refs[stepIdx]?.current;
    if (!target || typeof target.scrollIntoView !== 'function') return;
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: reduced ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  };

  const irAPaso = (stepIdx) => {
    setVerTodo(false);
    setPasoActual(stepIdx);
    setPasoDesbloqueado((prev) => Math.max(prev, stepIdx));
    scrollSuaveAPaso(stepIdx);
  };

  // Centrar paso activo en el stepper horizontal en pantallas angostas
  useEffect(() => {
    const track = stepperTrackRef.current;
    if (!track) return;
    const activeEl = track.querySelector('.stepper-step.is-active');
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
    }
  }, [pasoActual, verTodo]);

  const toggleActivoManual = (sym) => {
    setActivosManuales((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    );
  };

  const capNum = Math.max(100, Number(String(capitalStr).replace(/[^0-9.]/g, '') || 1000));

  const portafolioData = useMemo(
    () =>
      portafolioRemoto ||
      construirPortafolioInicial(perfilSel, capNum, anios, maxPeso),
    [portafolioRemoto, perfilSel, capNum, anios, maxPeso]
  );

  const handleCalcular = async (e) => {
    if (e) e.preventDefault();
    if (!uid || calculando) return;
    if (modoActivos === 'manual' && activosManuales.length < 3) {
      const msg = 'Selecciona al menos 3 activos para optimizar la cartera.';
      setErrorCalc(msg);
      onToast?.(msg, 'warn');
      return;
    }
    setErrorCalc('');
    setCalculando(true);
    setReiniciadoManual(false);
    setVerTodo(false);
    setRespuestaIA('');
    try {
      const res = await solicitarPortafolioML(uid, {
        perfil: perfilSel,
        capital: capNum,
        activos: modoActivos === 'manual' ? activosManuales : null,
        max_peso: Number(maxPeso),
        anios: Number(anios),
      });
      if (res?.id) {
        try {
          window.localStorage.setItem(`bolsalab_ultimo_portafolio_${uid}`, res.id);
        } catch {
          // ignorar si localStorage no está disponible
        }
      }
      setPortafolioRemoto(res);
      setCarteraActivaIdx(0);
      setPasoActual(1);
      setPasoDesbloqueado(1);
      onToast?.('Portafolio ML calculado y optimizado correctamente.', 'success');
      scrollSuaveAPaso(1);
    } catch (err) {
      const raw = String(err?.message || '');
      let msg;
      if (
        err?.code === 'permission-denied' ||
        /Missing or insufficient permissions/i.test(raw)
      ) {
        msg =
          'Falta publicar las reglas de Firestore (npx firebase-tools deploy --only firestore:rules)';
      } else if (/Tiempo de espera|timeout|no respondió/i.test(raw)) {
        msg = 'El bot de Python no está corriendo';
      } else {
        msg = raw || 'El bot de Python no está corriendo';
      }
      setErrorCalc(msg);
      onToast?.(msg, 'error');
    } finally {
      setCalculando(false);
    }
  };

  // Las 5 carteras completas y detección de coincidencia con Recomendada
  const { carterasTodas, tarjetasBase4, idxRecomendadaEnBase4, coincideNombre } = useMemo(() => {
    const raw = Array.isArray(portafolioData?.carteras) ? portafolioData.carteras : [];
    const rec = raw.find((c) =>
      String(c.nombre || '').toLowerCase().startsWith('recomendada')
    );
    const base4 = raw.filter(
      (c) => !String(c.nombre || '').toLowerCase().startsWith('recomendada')
    );

    const ordenDeseado = [
      'Máximo Sharpe',
      'Mínima varianza',
      'Paridad de riesgo',
      'Pesos iguales',
    ];
    const ordenadas = [];
    ordenDeseado.forEach((pref) => {
      const match = base4.find((c) =>
        String(c.nombre || '')
          .toLowerCase()
          .includes(pref.toLowerCase().slice(0, 8))
      );
      if (match && !ordenadas.includes(match)) ordenadas.push(match);
    });
    base4.forEach((c) => {
      if (!ordenadas.includes(c)) ordenadas.push(c);
    });

    let idxRec = -1;
    let nombreCoincide = null;

    if (rec) {
      const firmaRec = firmaPesosCartera(rec);
      const foundIdx = ordenadas.findIndex(
        (t) =>
          firmaPesosCartera(t) === firmaRec ||
          (Math.abs(Number(t.volatilidad) - Number(rec.volatilidad)) < 0.05 &&
            Math.abs(Number(t.rendimiento) - Number(rec.rendimiento)) < 0.05)
      );
      if (foundIdx >= 0) {
        idxRec = foundIdx;
        nombreCoincide = ordenadas[foundIdx].nombre;
      }
    }

    const cincoCarteras = rec ? [rec, ...ordenadas] : ordenadas;

    return {
      carterasTodas: cincoCarteras,
      tarjetasBase4: ordenadas.slice(0, 4),
      idxRecomendadaEnBase4: idxRec,
      coincideNombre: nombreCoincide,
    };
  }, [portafolioData]);

  const carteraSeleccionada =
    carterasTodas[carteraActivaIdx] || carterasTodas[0] || null;

  // Explicar portafolio con Gemini
  const handleExplicarIA = async () => {
    if (!uid || analizandoIA) return;
    setAnalizandoIA(true);
    setRespuestaIA('');
    try {
      const c = carteraSeleccionada || carterasTodas[0];
      const pesosTxt = (c?.pesos || [])
        .map(
          (p) =>
            `${p.sym} (${(Number(p.peso) * 100).toFixed(1)}%, régimen ${p.regimen || 'media'})`
        )
        .join(', ');
      const regAlta = (portafolioData.activos || [])
        .filter((a) => a.regimen === 'alta')
        .map((a) => a.sym)
        .join(', ');
      const mlReg = portafolioData.ml?.regimen;
      const mlRend = portafolioData.ml?.rendimiento;
      const { fila: mejorReg } = obtenerMejorModelo(mlReg?.modelos, mlReg?.mejor);
      const { fila: mejorRend } = obtenerMejorModelo(mlRend?.modelos, mlRend?.mejor);

      const contextoResumen = [
        `PORTAFOLIO ML (perfil ${portafolioData.perfil || perfilSel}, capital $${fmtNum(capNum, 2)} USD, ${portafolioData.anios || anios} años):`,
        `Cartera seleccionada: ${c?.nombre} — Rendimiento esperado ${fmtNum(c?.rendimiento, 2)}%, Volatilidad ${fmtNum(c?.volatilidad, 2)}%, Sharpe ${fmtNum(c?.sharpe, 2)}, Sortino ${fmtNum(c?.sortino, 2)}, VaR95 ${fmtNum(c?.var95_dia, 2)}%, CVaR95 ${fmtNum(c?.cvar95_dia, 2)}%.`,
        `Pesos: ${pesosTxt}.`,
        `Activos en régimen de volatilidad ALTA: ${regAlta || 'ninguno'}.`,
        mejorReg
          ? `Validación Opción 1 (Régimen): ${mejorReg.modelo} Accuracy ${fmtNum(mejorReg.accuracy, 1)}%, F1 ${fmtNum(mejorReg.f1, 3)}, DM ${fmtNum(mejorReg.dm, 2)} (p=${fmtNum(mejorReg.p, 3)}).`
          : '',
        mejorRend
          ? `Validación Opción 2 (Rendimiento 20d): ${mejorRend.modelo} RMSE ${fmtNum(mejorRend.rmse, 2)}%, MAPE ${fmtNum(mejorRend.mape, 2)}%, Variance Score ${fmtNum(mejorRend.variance_score, 3)}, DM ${fmtNum(mejorRend.dm, 2)} (p=${fmtNum(mejorRend.p, 3)}).`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const res = await consultarGemini({
        uid,
        pregunta:
          'Explica en español claro por qué se eligieron estos activos y pesos según mi perfil, qué significan los regímenes de volatilidad y cómo interpretar las métricas (Sharpe, Sortino, VaR/CVaR y Diebold-Mariano).',
        contexto: contextoResumen,
      });
      setRespuestaIA(res?.respuesta || 'Sin respuesta disponible.');
    } catch {
      setRespuestaIA('El bot no respondió. Revisa que esté corriendo.');
    } finally {
      setAnalizandoIA(false);
    }
  };

  // Datos para gráfica de Frontera Eficiente + nube de carteras al azar
  const fronteraGrafico = useMemo(() => {
    const frontera = Array.isArray(portafolioData?.frontera)
      ? portafolioData.frontera
      : [];
    const activos = Array.isArray(portafolioData?.activos)
      ? portafolioData.activos
      : [];

    const W = 540;
    const H = 260;
    const pad = { l: 42, r: 24, t: 18, b: 30 };

    const vols = [
      ...frontera.map((f) => Number(f.volatilidad)),
      ...carterasTodas.map((c) => Number(c.volatilidad)),
    ].filter(Number.isFinite);
    const rets = [
      ...frontera.map((f) => Number(f.rendimiento)),
      ...carterasTodas.map((c) => Number(c.rendimiento)),
    ].filter(Number.isFinite);

    const minV = Math.min(10, Math.floor(Math.min(...vols, 10)));
    const maxV = Math.max(26, Math.ceil(Math.max(...vols, 25)));
    const minR = Math.min(0, Math.floor(Math.min(...rets, 0)));
    const maxR = Math.max(16, Math.ceil(Math.max(...rets, 16)));

    const xPos = (v) =>
      pad.l + ((v - minV) / Math.max(1e-6, maxV - minV)) * (W - pad.l - pad.r);
    const yPos = (r) =>
      H - pad.b - ((r - minR) / Math.max(1e-6, maxR - minR)) * (H - pad.t - pad.b);

    const curvaPts = [...frontera]
      .sort((a, b) => Number(a.volatilidad) - Number(b.volatilidad))
      .map((f) => `${xPos(f.volatilidad).toFixed(1)},${yPos(f.rendimiento).toFixed(1)}`)
      .join(' ');

    // Nube determinista de carteras al azar debajo de la frontera
    const nubeAzar = [];
    for (let i = 0; i < 165; i++) {
      const s1 = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
      const u1 = s1 - Math.floor(s1);
      const s2 = Math.sin(i * 78.233 + 1.618) * 19341.1234;
      const u2 = s2 - Math.floor(s2);

      const v = 11.8 + u1 * 13.0;
      const techo = 2.25 + Math.pow((v - 11.5) / 13.5, 0.52) * 13.1;
      const r = Math.max(0.3, techo - (0.35 + u2 * 8.5));
      if (v >= minV && v <= maxV && r >= minR && r <= maxR) {
        nubeAzar.push({ cx: xPos(v), cy: yPos(r), id: i });
      }
    }

    const coloresPorTipo = (nombre) => {
      const n = String(nombre || '').toLowerCase();
      if (n.includes('sharpe')) return '#22C55E';
      if (n.includes('mínima') || n.includes('minima')) return '#C4B5FD';
      if (n.includes('paridad')) return '#EAB308';
      if (n.includes('recomendada')) return '#8B5CF6';
      return '#94A3B8';
    };

    // Si Recomendada coincide en pesos con una de las 4 carteras base, dibujamos un solo punto con "X = Recomendada"
    const carterasParaPuntos =
      idxRecomendadaEnBase4 >= 0 ? tarjetasBase4 : carterasTodas;

    const placed = [];
    const puntosCarteras = carterasParaPuntos.map((c, idx) => {
      const n = String(c.nombre || '');
      const esCoincidente = idxRecomendadaEnBase4 >= 0 && idx === idxRecomendadaEnBase4;
      let etiqueta = n.split(' (')[0];
      if (n.toLowerCase().includes('sharpe')) etiqueta = 'Máx. Sharpe';
      else if (n.toLowerCase().includes('mínima') || n.toLowerCase().includes('minima'))
        etiqueta = 'Mínima varianza';
      else if (n.toLowerCase().includes('paridad')) etiqueta = 'Paridad';
      else if (n.toLowerCase().includes('iguales')) etiqueta = '1/N';

      if (esCoincidente) {
        etiqueta = `${etiqueta} = Recomendada`;
      }

      const cx = xPos(Number(c.volatilidad));
      const cy = yPos(Number(c.rendimiento));
      const color = coloresPorTipo(c.nombre);
      let lx = cx + 7;
      let ly = cy - 5;
      for (const p of placed) {
        if (Math.abs(lx - p.lx) < 95 && Math.abs(ly - p.ly) < 14) {
          ly = p.ly + 14;
        }
      }
      placed.push({ lx, ly });
      const idxEnTodas = carterasTodas.findIndex((ct) => ct.nombre === c.nombre);
      return {
        idx: idxEnTodas >= 0 ? idxEnTodas : 0,
        cx,
        cy,
        lx,
        ly,
        color,
        etiqueta,
        volatilidad: c.volatilidad,
        rendimiento: c.rendimiento,
      };
    });

    const puntosActivos = activos
      .filter(
        (a) =>
          Number.isFinite(Number(a.volatilidad)) &&
          Number.isFinite(Number(a.rend_usado))
      )
      .map((a) => ({
        ...a,
        cx: xPos(Math.min(maxV - 0.5, Math.max(minV + 0.5, Number(a.volatilidad)))),
        cy: yPos(Math.min(maxR - 0.5, Math.max(minR + 0.5, Number(a.rend_usado)))),
      }));

    return {
      W,
      H,
      pad,
      xPos,
      yPos,
      curvaPts,
      nubeAzar,
      puntosCarteras,
      puntosActivos,
      xTicks: [10, 14, 18, 22, 26],
      yTicks: [0, 4, 8, 12, 16],
    };
  }, [portafolioData, carterasTodas, tarjetasBase4, idxRecomendadaEnBase4]);

  // Datos de la dona de composición
  const pesosDona = useMemo(() => {
    const lista = [...(carteraSeleccionada?.pesos || [])]
      .filter((p) => Number(p.peso || 0) > 0.001)
      .sort((a, b) => Number(b.peso) - Number(a.peso));
    let acum = 0;
    return lista.map((p, idx) => {
      const peso = Number(p.peso || 0);
      const ini = acum;
      acum += peso;
      const cot = precios?.[p.sym];
      const pxVivo =
        cot?.disponible && Number(cot.p) > 0
          ? Number(cot.p)
          : Number(p.precio || 100);
      const montoUSD = Number(p.monto || capNum * peso);
      return {
        ...p,
        symCorto: String(p.sym || '').replace('_USDT', ''),
        nombreLargo: p.nombre || MAPA_ACTIVOS[p.sym]?.nombre || p.sym,
        clase: p.clase || MAPA_ACTIVOS[p.sym]?.clase || 'STOCK',
        color: COLORES_DONA[idx % COLORES_DONA.length],
        ini,
        fin: acum,
        pct: peso * 100,
        montoUSD,
        precioVivo: pxVivo,
        cantidadEst: pxVivo > 0 ? montoUSD / pxVivo : 0,
      };
    });
  }, [carteraSeleccionada, precios, capNum]);

  // Invertir cartera en la cuenta del usuario de forma atómica (Portafolio 1, Portafolio 2, ...)
  const handleInvertirCartera = async () => {
    if (!uid || !perfil || !carteraSeleccionada || invirtiendo) return;
    setInvirtiendo(true);
    try {
      const items = pesosDona.map((item) => {
        const cot = precios?.[item.sym];
        const px =
          cot?.disponible && Number(cot.p) > 0
            ? Number(cot.p)
            : Number(item.precioVivo || 0);
        return {
          sym: item.sym,
          nombre: item.nombreLargo,
          clase: item.clase,
          peso: Number(item.peso || 0),
          precio: px,
        };
      });

      const spyPrecio = Number(precios?.SPY?.p || 0);
      const res = await invertirCarteraPortafolioUsuario(uid, {
        items,
        capitalObjetivo: capNum,
        portafolioMeta: {
          portafolioId: portafolioData.id,
          perfil: perfilSel,
          nombreCartera: carteraSeleccionada.nombre,
          contexto: contextoInversion,
          spyPrecioInicial: spyPrecio > 0 ? spyPrecio : null,
        },
      });

      setModalInvertir(false);
      setContextoInversion('');
      setMisPortafoliosExpandido(true);
      setJustoInvirtioId(res.portafolioGuardado.id);
      onToast?.(
        `Se invirtieron ${res.comprados} activos en ${res.portafolioGuardado.alias} ("${carteraSeleccionada.nombre}").`,
        'success'
      );

      requestAnimationFrame(() => {
        misPortafoliosRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    } catch (err) {
      onToast?.(err?.message || 'No se pudo invertir la cartera.', 'error');
    } finally {
      setInvirtiendo(false);
    }
  };

  const handleRebalancear = async (portafolioTarget) => {
    if (!uid || !perfil || !portafolioTarget || rebalanceandoId) return;
    setRebalanceandoId(portafolioTarget.id);
    try {
      const valorTotal = Number(portafolioTarget.valorActual || 0);
      if (valorTotal <= 10) {
        onToast?.(
          `No hay posiciones abiertas activas en ${portafolioTarget.alias} para rebalancear.`,
          'info'
        );
        return;
      }
      let perfilTemp = {
        ...perfil,
        posiciones: { ...(perfil.posiciones || {}) },
        saldo: Number(perfil.saldo ?? SALDO_INICIAL),
        pnlRealizadoTotal: Number(perfil.pnlRealizadoTotal || 0),
      };
      let ajustes = 0;
      for (const f of portafolioTarget.filas || []) {
        if (f.precioVivo <= 0 || f.cerradaManual) continue;
        const objetivoUSD = (valorTotal * f.pesoObjetivoPct) / 100;
        const diff = objetivoUSD - f.valorActual;
        if (diff < -5 && f.cantActiva > 1e-8) {
          const cantCuenta = Number(perfilTemp.posiciones?.[f.sym]?.cant || 0);
          if (cantCuenta <= 1e-8) continue;
          const usdVenta = Math.min(Math.abs(diff), cantCuenta * f.precioVivo);
          const fraccion = Math.min(1, usdVenta / Math.max(1e-6, cantCuenta * f.precioVivo));
          const resOp = await ejecutarOperacionUsuario(uid, perfilTemp, {
            tipo: 'venta',
            sym: f.sym,
            precio: f.precioVivo,
            fraccionVenta: fraccion,
            origen: 'portafolio',
            nota: `Rebalanceo ${portafolioTarget.alias}`,
            portafolioId: portafolioTarget.portafolioId,
          });
          perfilTemp.saldo = resOp.nuevoSaldo;
          if (resOp.nuevasPosiciones) perfilTemp.posiciones = resOp.nuevasPosiciones;
          if (typeof resOp.nuevoPnlRealizadoTotal === 'number') {
            perfilTemp.pnlRealizadoTotal = resOp.nuevoPnlRealizadoTotal;
          }
          ajustes += 1;
        } else if (diff > 5) {
          const monto = Math.min(diff, Number(perfilTemp.saldo ?? 0) / (1 + COMISION));
          if (monto >= 5) {
            const resOp = await ejecutarOperacionUsuario(uid, perfilTemp, {
              tipo: 'compra',
              sym: f.sym,
              precio: f.precioVivo,
              montoUSD: monto,
              origen: 'portafolio',
              nota: `Rebalanceo ${portafolioTarget.alias}`,
              portafolioId: portafolioTarget.portafolioId,
            });
            perfilTemp.saldo = resOp.nuevoSaldo;
            if (resOp.nuevasPosiciones) perfilTemp.posiciones = resOp.nuevasPosiciones;
            if (typeof resOp.nuevoPnlRealizadoTotal === 'number') {
              perfilTemp.pnlRealizadoTotal = resOp.nuevoPnlRealizadoTotal;
            }
            ajustes += 1;
          }
        }
      }
      onToast?.(
        ajustes > 0
          ? `${portafolioTarget.alias} rebalanceado (${ajustes} órdenes de ajuste ejecutadas).`
          : `${portafolioTarget.alias} ya está alineado con los pesos objetivo.`,
        'success'
      );
    } catch (err) {
      onToast?.(err?.message || 'No se pudo rebalancear el portafolio.', 'error');
    } finally {
      setRebalanceandoId(null);
    }
  };

  // Datos de prueba fuera de muestra (OOS) reales devueltos por el bot
  const oos = portafolioData?.fuera_de_muestra || null;
  const bt = portafolioData?.backtest || {};
  const sharpeML = oos?.sharpe_real_con_ml ?? bt.sharpe_ml ?? null;
  const sharpeHist = oos?.sharpe_real_historico ?? bt.sharpe_hist ?? null;
  const sharpeMinVar = oos?.sharpe_real_minvar ?? bt.sharpe_minvar ?? null;
  const sharpeParidad = oos?.sharpe_real_paridad ?? bt.sharpe_paridad ?? null;
  const sharpe1N = oos?.sharpe_real_1n ?? bt.sharpe_1n ?? null;
  const sharpeSpy = oos?.sharpe_real_spy ?? bt.sharpe_spy ?? null;

  const retOosML = Number(oos?.sharpe_con_ml);
  const retOosHist = Number(oos?.sharpe_historico);
  const retOosSpy = Number(oos?.spy);
  const mlSuperaSpyOos =
    Number.isFinite(retOosML) && Number.isFinite(retOosSpy) ? retOosML >= retOosSpy : null;
  const mlSuperaHistOos =
    Number.isFinite(retOosML) && Number.isFinite(retOosHist) ? retOosML >= retOosHist : null;

  const var95Ref = Number(carteraSeleccionada?.var95_dia ?? 1.13);
  const perdidaDiaMaloUSD = Math.max(1, Math.round((capNum * var95Ref) / 100));

  // Datos de validación ML (Sección 5.7 bis: Opciones 1 y 2)
  const mlData = portafolioData?.ml || null;
  const mlReg = mlData?.regimen || null;
  const mlRend = mlData?.rendimiento || null;

  const { idx: idxMejorReg, fila: mejorRegFila } = obtenerMejorModelo(
    mlReg?.modelos,
    mlReg?.mejor
  );
  const { idx: idxMejorRend, fila: mejorRendFila } = obtenerMejorModelo(
    mlRend?.modelos,
    mlRend?.mejor
  );

  const tieneResultados = Boolean(portafolioRemoto);
  const activosLista = Array.isArray(portafolioData?.activos) ? portafolioData.activos : [];
  const activosAltoRiesgo = activosLista.filter(
    (a) => String(a.regimen || '').toLowerCase() === 'alta'
  ).length;
  const perfilLabel =
    perfilSel === 'moderado'
      ? 'Moderado'
      : perfilSel === 'agresivo'
        ? 'Agresivo'
        : 'Conservador';

  const handleEmpezarDeNuevo = () => {
    setReiniciadoManual(true);
    setPortafolioRemoto(null);
    setVerTodo(false);
    setPasoActual(0);
    setPasoDesbloqueado(0);
    setErrorCalc('');
    setRespuestaIA('');
    scrollSuaveAPaso(0);
  };

  const handlePrepararNuevoPortafolio = () => {
    setMisPortafoliosExpandido(false);
    handleEmpezarDeNuevo();
    if (portafoliosGuardados.length > 0) {
      onToast?.(
        `Configura tu Portafolio ${siguienteNumeroPortafolio}: los anteriores se conservarán intactos.`,
        'info'
      );
    }
  };

  // Qué secciones mostrar y en qué estado (colapsado / expandido)
  const paso0Visible = true;
  const paso0Expandido = !tieneResultados || (!verTodo && pasoActual === 0);
  const mostrarPaso1 = tieneResultados && (verTodo || pasoDesbloqueado >= 1);
  const paso1Expandido = verTodo || pasoActual === 1;
  const mostrarPaso2 = tieneResultados && (verTodo || pasoDesbloqueado >= 2);
  const paso2Expandido = verTodo || pasoActual === 2;
  const mostrarPaso3 = tieneResultados && (verTodo || pasoDesbloqueado >= 3);
  const paso3Expandido = verTodo || pasoActual === 3;

  return (
    <div
      className="portafolio-terminal-page"
      style={{ '--stepper-top': `${stickyTopPx}px` }}
    >
      {/* STEPPER STICKY DEBAJO DEL HEADER */}
      <nav
        className={`portafolio-stepper-bar ${calculando ? 'is-calculating' : ''}`}
        aria-label="Progreso del asistente de portafolio"
      >
        <div className="stepper-track" role="tablist" ref={stepperTrackRef}>
          {PASOS_ASISTENTE.map((s, idx) => {
            const esActivo = !verTodo && s.id === pasoActual;
            const esCompletado = verTodo
              ? tieneResultados
              : s.id < pasoActual || (tieneResultados && s.id <= pasoDesbloqueado && s.id !== pasoActual);
            const esPendiente = !esActivo && !esCompletado;
            const esClickable = !calculando && !esPendiente && !esActivo;
            const lineaLlena =
              (verTodo && tieneResultados) ||
              idx < pasoActual ||
              (tieneResultados && idx < pasoDesbloqueado);

            return (
              <React.Fragment key={s.id}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={esActivo}
                  disabled={!esClickable}
                  onClick={() => {
                    if (esClickable) irAPaso(s.id);
                  }}
                  className={`stepper-step ${esActivo ? 'is-active' : ''} ${
                    esCompletado ? 'is-done' : ''
                  } ${esPendiente ? 'is-pending' : ''}`}
                  title={esPendiente ? 'Completa los pasos anteriores' : s.nombre}
                >
                  <span className="stepper-circle num">
                    {esCompletado ? <Check size={13} strokeWidth={2.6} /> : s.id}
                  </span>
                  <span className="stepper-label">{s.corto}</span>
                </button>
                {idx < PASOS_ASISTENTE.length - 1 && (
                  <div
                    className={`stepper-line ${
                      calculando && idx === 0 ? 'is-loading' : ''
                    }`}
                    aria-hidden="true"
                  >
                    <span
                      className="stepper-line-fill"
                      style={{ width: lineaLlena ? '100%' : '0%' }}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        <button
          type="button"
          className={`stepper-viewall-btn ${verTodo ? 'active' : ''}`}
          disabled={!tieneResultados || calculando}
          onClick={() => setVerTodo((v) => !v)}
          title={
            tieneResultados
              ? verTodo
                ? 'Volver al asistente paso a paso'
                : 'Mostrar los 3 pasos completos a la vez'
              : 'Calcula tu portafolio primero'
          }
        >
          <Layers size={13} />
          <span>{verTodo ? 'Modo pasos' : 'Ver todo'}</span>
        </button>

        {calculando && <div className="stepper-calc-bar" aria-hidden="true" />}
      </nav>

      {errorCalc && (
        <div className="portafolio-error-banner" role="alert">
          {errorCalc}
        </div>
      )}

      {/* PORTAFOLIOS YA INVERTIDOS (Portafolio 1, Portafolio 2, contexto y suma total de pesos) */}
      <MisPortafoliosInvertidos
        uid={uid}
        panelRef={misPortafoliosRef}
        seguimiento={seguimientoPortafolios}
        expandido={misPortafoliosExpandido}
        onToggleExpandido={() => setMisPortafoliosExpandido((v) => !v)}
        justoInvirtioId={justoInvirtioId}
        rebalanceandoId={rebalanceandoId}
        onRebalancear={handleRebalancear}
        onPrepararNuevoPortafolio={handlePrepararNuevoPortafolio}
        onSelectSeccion={onSelectSeccion}
        onToast={onToast}
      />

      {/* PASO 0 · CONFIGURA */}
      {paso0Visible && (
        <section
          ref={paso0Ref}
          id="paso-0-configura"
          className={`paso-shell paso-enter ${paso0Expandido ? 'is-expanded' : 'is-collapsed'}`}
        >
          {!paso0Expandido && (
            <div className="paso-collapsed-bar">
              <div className="paso-collapsed-left">
                <span className="paso-check-pill">
                  <Check size={12} /> Paso 0 · Configura
                </span>
                <span className="paso-collapsed-summary">
                  Perfil <strong>{perfilLabel}</strong> ·{' '}
                  <span className="num">${fmtNum(capNum, 0)}</span> ·{' '}
                  <span className="num">{anios}</span> años · Máx{' '}
                  <span className="num">{Math.round(maxPeso * 100)}%</span> ·{' '}
                  {modoActivos === 'manual'
                    ? `${activosManuales.length} activos elegidos`
                    : 'Activos automáticos'}
                </span>
              </div>
              <button
                type="button"
                className="paso-detail-btn"
                disabled={calculando}
                onClick={() => irAPaso(0)}
              >
                Editar
              </button>
            </div>
          )}

          <div className="paso-expandable">
            <div className="paso-expandable-inner">
              <form className="portafolio-top-bar paso-stagger" onSubmit={handleCalcular}>
                <div className="portafolio-top-left">
                  <div className="paso-title-row">
                    <span className="step-badge num">0</span>
                    <h1 className="portafolio-main-title">Mi portafolio a largo plazo</h1>
                  </div>
                  <span className="portafolio-steps-crumb">
                    Configura tu perfil de riesgo, capital y universo de activos para ejecutar los
                    modelos ML y Markowitz.
                  </span>
                </div>

                <div className="portafolio-top-right">
                  <div
                    className="portafolio-risk-pills"
                    role="radiogroup"
                    aria-label="Perfil de riesgo"
                  >
                    {[
                      { id: 'conservador', label: 'Conservador' },
                      { id: 'moderado', label: 'Moderado' },
                      { id: 'agresivo', label: 'Agresivo' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`portafolio-risk-pill ${perfilSel === p.id ? 'active' : ''}`}
                        onClick={() => setPerfilSel(p.id)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <div className="portafolio-cap-input-wrap" title="Capital a invertir (USD)">
                    <span className="cap-prefix num">$</span>
                    <input
                      type="text"
                      className="portafolio-cap-input num"
                      value={Number(capitalStr || 0).toLocaleString('en-US')}
                      onChange={(e) => setCapitalStr(e.target.value.replace(/[^0-9]/g, ''))}
                      aria-label="Capital a invertir"
                    />
                  </div>

                  <select
                    className="portafolio-ctrl-select num"
                    value={anios}
                    onChange={(e) => setAnios(Number(e.target.value))}
                    aria-label="Años de historia"
                    title="Años de historia diaria"
                  >
                    <option value={3}>3 años</option>
                    <option value={5}>5 años</option>
                    <option value={10}>10 años</option>
                  </select>

                  <select
                    className="portafolio-ctrl-select num"
                    value={maxPeso}
                    onChange={(e) => setMaxPeso(Number(e.target.value))}
                    aria-label="Peso máximo por activo"
                    title="Peso máximo permitido por activo"
                  >
                    <option value={0.2}>Máx 20%</option>
                    <option value={0.25}>Máx 25%</option>
                    <option value={0.35}>Máx 35%</option>
                    <option value={0.5}>Máx 50%</option>
                  </select>

                  <select
                    className="portafolio-ctrl-select"
                    value={modoActivos}
                    onChange={(e) => setModoActivos(e.target.value)}
                    aria-label="Selección de activos"
                  >
                    <option value="auto">Activos: Automático</option>
                    <option value="manual">Elegidos por mí ({activosManuales.length})</option>
                  </select>

                  <button
                    type="submit"
                    className="portafolio-calc-btn"
                    disabled={calculando}
                  >
                    {calculando ? 'Calculando...' : 'Calcular'}
                  </button>
                </div>

                {modoActivos === 'manual' && (
                  <div className="portafolio-manual-picker" style={{ width: '100%' }}>
                    <div className="manual-picker-head">
                      <span>
                        Haz clic para agregar o quitar activos de tu cartera (mínimo 3 ·{' '}
                        <strong className="num">{activosManuales.length}</strong> seleccionados):
                      </span>
                    </div>
                    <div className="manual-picker-chips">
                      {CATALOGO_ACTIVOS.map((a) => {
                        const sel = activosManuales.includes(a.sym);
                        return (
                          <button
                            key={a.sym}
                            type="button"
                            className={`manual-asset-chip ${sel ? 'active' : ''}`}
                            onClick={() => toggleActivoManual(a.sym)}
                          >
                            <span>{a.sym.replace('_USDT', '')}</span>
                            <small>{a.nombre}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </form>
            </div>
          </div>
        </section>
      )}

      {/* SKELETON SHIMMER MIENTRAS EL BOT CALCULA O CARGA EL ÚLTIMO PORTAFOLIO */}
      {(calculando || cargandoInicial) && (
        <section
          className="portafolio-skeleton-wrap"
          aria-live="polite"
          aria-label="Calculando Paso 1"
        >
          <div className="portafolio-panel-card skeleton-card">
            <div className="skeleton-line lg" />
            <div className="skeleton-line md" />
          </div>
          <div className="portafolio-panel-card skeleton-card">
            <div className="skeleton-line md" />
            <div className="skeleton-table-rows">
              <div className="skeleton-line row" />
              <div className="skeleton-line row" />
              <div className="skeleton-line row" />
              <div className="skeleton-line row" />
            </div>
          </div>
          <div className="portafolio-panel-card skeleton-card">
            <div className="skeleton-line md" />
            <div className="skeleton-cm-grid">
              <div className="skeleton-box" />
              <div className="skeleton-box" />
              <div className="skeleton-box" />
              <div className="skeleton-box" />
              <div className="skeleton-box" />
              <div className="skeleton-box" />
            </div>
          </div>
        </section>
      )}

      {/* PASO 1 · CLASIFICAMOS EL RIESGO (OPCIÓN 1) */}
      {!calculando && mostrarPaso1 && (
        <section
          ref={paso1Ref}
          id="paso-1-riesgo"
          className={`paso-shell paso-enter ${paso1Expandido ? 'is-expanded' : 'is-collapsed'}`}
        >
          {!paso1Expandido && (
            <div className="paso-collapsed-bar">
              <div className="paso-collapsed-left">
                <span className="paso-check-pill">
                  <Check size={12} /> Riesgo
                </span>
                <span className="paso-collapsed-summary">
                  <span className="num">{activosLista.length}</span> activos ·{' '}
                  <span className="num">{activosAltoRiesgo}</span> en régimen alto · Mejor:{' '}
                  <strong>{mejorRegFila?.modelo || 'ML'}</strong>
                </span>
              </div>
              <button
                type="button"
                className="paso-detail-btn"
                onClick={() => irAPaso(1)}
              >
                Ver detalle
              </button>
            </div>
          )}

          <div className="paso-expandable">
            <div className="paso-expandable-inner">
              <div className="paso-content-stack paso-stagger">
                <div className="portafolio-step-card">
                  <div className="step-card-head">
                    <span className="step-badge num">1</span>
                    <strong>Clasificamos el riesgo de cada activo (Opción 1)</strong>
                  </div>
                  <p className="step-card-desc">
                    Tres modelos de Inteligencia Artificial (<strong>Random Forest</strong>,{' '}
                    <strong>KNN</strong> y <strong>Red neuronal</strong>) analizan qué tan brusco
                    sube y baja cada activo y lo clasifican en volatilidad{' '}
                    <strong>baja</strong> (estable), <strong>media</strong> o{' '}
                    <strong>alta</strong> (muy movido). Si elegiste perfil{' '}
                    <strong>Conservador</strong>, se descartan los de riesgo alto; en{' '}
                    <strong>Moderado</strong>, se limitan a máximo 10%.
                  </p>
                </div>

                {/* Tabla de régimen por activo */}
                <div className="portafolio-panel-card">
                  <div className="p-panel-head">
                    <strong>
                      Régimen de volatilidad por activo (Paso 1 · relativo a su propia historia)
                    </strong>
                    <span className="p-panel-sub">
                      · se compara cada activo contra sus propios terciles históricos (baja / media /
                      alta vs. sí mismo) + volatilidad anual absoluta
                    </span>
                  </div>
                  <div className="ml-plain-guide" style={{ marginBottom: '10px' }}>
                    <span>
                      <strong>¿Por qué Bitcoin puede salir en BAJA y el Oro en ALTA?</strong> Porque
                      el <strong>RÉGIMEN ML</strong> mide si el activo está tranquilo o agitado{' '}
                      <strong>comparado contra su propio historial</strong> (terciles propios): un
                      51% anual en BTC es su tercio más calmo, mientras un 19% anual en el Oro (GLD)
                      es su tercio más movido. En la columna <strong>VOL. ANUAL (ABS.)</strong>{' '}
                      mostramos además el nivel de riesgo absoluto entre activos.
                    </span>
                  </div>
                  <div className="ml-dense-table-wrap">
                    <table className="terminal-dense-table">
                      <thead>
                        <tr>
                          <th>ACTIVO</th>
                          <th>CLASE</th>
                          <th>RÉGIMEN ML (VS. SU HISTORIA)</th>
                          <th className="num">PROB.</th>
                          <th className="num">VOL. ANUAL (ABS.)</th>
                          <th className="num">TOPE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activosLista.map((a) => {
                          const reg = String(a.regimen || 'media').toLowerCase();
                          const volAnual = Number(a.volatilidad || 0);
                          const absNivel =
                            volAnual < 20 ? 'Abs. baja' : volAnual < 40 ? 'Abs. media' : 'Abs. alta';
                          const prob = Number.isFinite(Number(a.prob_regimen))
                            ? `${fmtNum(Number(a.prob_regimen) * 100, 0)}%`
                            : '—';
                          const tope = Number.isFinite(Number(a.tope))
                            ? `${fmtNum(Number(a.tope) * 100, 0)}%`
                            : `${Math.round(maxPeso * 100)}%`;
                          return (
                            <tr key={`p1_${a.sym}`}>
                              <td>
                                <strong>{String(a.sym || '').replace('_USDT', '')}</strong>{' '}
                                <span className="text-sec">{a.nombre}</span>
                              </td>
                              <td className="text-sec">{a.clase || MAPA_ACTIVOS[a.sym]?.clase || 'STOCK'}</td>
                              <td>
                                <span
                                  className={`dense-side-pill ${
                                    reg === 'baja' ? 'long' : reg === 'alta' ? 'short' : 'spot'
                                  }`}
                                  title="Régimen actual comparado contra los terciles históricos de este mismo activo"
                                >
                                  {reg.toUpperCase()} (propio)
                                </span>
                              </td>
                              <td className="num">{prob}</td>
                              <td className="num">
                                <strong>{fmtNum(volAnual, 1)}%</strong>{' '}
                                <small className="text-sec">({absNivel})</small>
                              </td>
                              <td className="num">{tope}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Validación Opción 1 */}
                {mlReg && (
                  <div className="portafolio-panel-card">
                    <div className="p-panel-head" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <strong>Opción 1 — Régimen de volatilidad (clasificación, diaria)</strong>
                        <div className="p-panel-sub">
                          Diaria, horizonte <span className="num">{mlData?.horizonte_dias || 20}</span>{' '}
                          días: en 5 o 15 minutos domina el ruido · Entrenamiento:{' '}
                          <span className="num">{mlData?.n_train}</span> obs. · Prueba:{' '}
                          <span className="num">{mlData?.n_test}</span> obs. · Corte:{' '}
                          <span className="num">{mlData?.corte}</span>
                        </div>
                      </div>
                      {mejorRegFila && (
                        <span
                          className={`ml-verdict-pill ${claseVeredictoDM(
                            mejorRegFila.dm,
                            mejorRegFila.p
                          )}`}
                        >
                          {fraseVeredictoDM(mejorRegFila.dm, mejorRegFila.p)}
                        </span>
                      )}
                    </div>

                    {mejorRegFila && (
                      <div className="ml-hero-callout" style={{ marginBottom: '10px' }}>
                        <strong>{fraseVeredictoDM(mejorRegFila.dm, mejorRegFila.p)}</strong> ·
                        Mejor clasificador: <strong>{mejorRegFila.modelo}</strong> (Accuracy{' '}
                        <span className="num">{fmtNum(mejorRegFila.accuracy, 1)}%</span> vs{' '}
                        <span className="num">{fmtNum(mlReg.base?.accuracy, 1)}%</span> del
                        ingenuo · DM <span className="num">{fmtNum(mejorRegFila.dm, 2)}</span>, p
                        = <span className="num">{fmtNum(mejorRegFila.p, 3)}</span>).
                      </div>
                    )}

                    <div className="ml-plain-guide">
                      <span>
                        <strong>En palabras sencillas:</strong> <strong>KNN</strong> usa{' '}
                        <strong>Distancia Euclidiana</strong>{' '}
                        <code>d(x, xᵢ) = √Σ(xⱼ − xᵢⱼ)²</code> sobre las 17 variables estandarizadas ·{' '}
                        <strong>ACCURACY</strong> = % de veces que acertó el nivel de riesgo ·{' '}
                        <strong>F1 (0 a 1)</strong> = calificación de equilibrio en riesgo bajo,
                        medio y alto · <strong>Ingenuo</strong> = regla simple que supone que
                        &ldquo;mañana habrá el mismo riesgo que hoy&rdquo; ·{' '}
                        <strong>DM y p</strong> = prueba para ver si la IA le gana a esa regla
                        simple.
                      </span>
                    </div>

                    <div className="ml-dense-table-wrap">
                      <table className="terminal-dense-table">
                        <thead>
                          <tr>
                            <th>MODELO</th>
                            <th className="num">ACCURACY</th>
                            <th className="num">F1</th>
                            {CLASES_VOLATILIDAD.map((cl) => (
                              <th key={`th_f1_${cl}`} className="num">
                                F1 {cl.toUpperCase()}
                              </th>
                            ))}
                            <th className="num">DM</th>
                            <th className="num">P</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(mlReg.modelos || []).map((m, idx) => {
                            const esMejor = idx === idxMejorReg;
                            const dm = Number(m.dm || 0);
                            return (
                              <tr
                                key={m.modelo}
                                className={esMejor ? 'ml-purple-best-row' : ''}
                              >
                                <td>
                                  <strong>{m.modelo}</strong>
                                </td>
                                <td className="num">{fmtNum(m.accuracy, 1)}%</td>
                                <td className="num">{fmtNum(m.f1, 3)}</td>
                                {CLASES_VOLATILIDAD.map((cl) => (
                                  <td key={`${m.modelo}_f1_${cl}`} className="num">
                                    {fmtF1Clase(m.f1_por_clase, cl, m, mlReg.matriz)}
                                  </td>
                                ))}
                                <td className={`num ${dm < 0 ? 'text-green' : 'text-red'}`}>
                                  {dm >= 0 ? '+' : ''}
                                  {fmtNum(dm, 2)}
                                </td>
                                <td className="num">{fmtNum(m.p, 3)}</td>
                              </tr>
                            );
                          })}
                          {mlReg.base && (
                            <tr className="text-sec">
                              <td>
                                {mlReg.base.modelo || 'Ingenuo (el régimen de mañana = el de hoy)'}
                              </td>
                              <td className="num">{fmtNum(mlReg.base.accuracy, 1)}%</td>
                              <td className="num">{fmtNum(mlReg.base.f1, 3)}</td>
                              {CLASES_VOLATILIDAD.map((cl) => (
                                <td key={`base_f1_${cl}`} className="num">
                                  {fmtF1Clase(
                                    mlReg.base.f1_por_clase,
                                    cl,
                                    mlReg.base,
                                    mlReg.matriz
                                  )}
                                </td>
                              ))}
                              <td className="num">—</td>
                              <td className="num">—</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <p className="portafolio-val-footnote">
                      F1 = promedio macro de las 3 clases. {NOTA_EXPLICACION_DM}
                    </p>

                    <MatrizConfusion
                      titulo="Matriz de confusión 3×3 (baja / media / alta)"
                      subtitulo="filas = régimen real · columnas = predicho"
                      etiquetas={mlReg.etiquetas || ['baja', 'media', 'alta']}
                      matriz={mlReg.matriz}
                      prefix="reg"
                    />
                  </div>
                )}

                {!verTodo && (
                  <div className="paso-footer-actions">
                    <button
                      type="button"
                      className="portafolio-next-btn"
                      onClick={() => irAPaso(2)}
                    >
                      <span>Continuar al Paso 2</span>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* PASO 2 · ESTIMAMOS EL RENDIMIENTO (OPCIÓN 2) */}
      {!calculando && mostrarPaso2 && (
        <section
          ref={paso2Ref}
          id="paso-2-rendimiento"
          className={`paso-shell paso-enter ${paso2Expandido ? 'is-expanded' : 'is-collapsed'}`}
        >
          {!paso2Expandido && (
            <div className="paso-collapsed-bar">
              <div className="paso-collapsed-left">
                <span className="paso-check-pill">
                  <Check size={12} /> Rendimiento
                </span>
                <span className="paso-collapsed-summary">
                  Mejor: <strong>{mejorRendFila?.modelo || 'ML'}</strong> (RMSE{' '}
                  <span className="num">{fmtNum(mejorRendFila?.rmse, 2)}%</span>, Dir.{' '}
                  <span className="num">{fmtNum(mejorRendFila?.acierto_direccion, 1)}%</span>) ·
                  Horizonte <span className="num">{mlData?.horizonte_dias || 20}</span> días
                </span>
              </div>
              <button
                type="button"
                className="paso-detail-btn"
                onClick={() => irAPaso(2)}
              >
                Ver detalle
              </button>
            </div>
          )}

          <div className="paso-expandable">
            <div className="paso-expandable-inner">
              <div className="paso-content-stack paso-stagger">
                <div className="portafolio-step-card">
                  <div className="step-card-head">
                    <span className="step-badge num">2</span>
                    <strong>Estimamos el rendimiento (Opción 2)</strong>
                  </div>
                  <p className="step-card-desc">
                    Calculamos cuánto podría subir o bajar cada activo en los próximos{' '}
                    <strong>20 días hábiles</strong> (~1 mes). Como ningún modelo adivina el futuro
                    sin margen de error, combinamos <strong>50% el pronóstico de la IA + 50% el
                    promedio histórico</strong> para obtener una estimación más prudente.
                  </p>
                </div>

                {/* Tabla rendimiento ML vs histórico por activo */}
                <div className="portafolio-panel-card">
                  <div className="p-panel-head">
                    <strong>Rendimiento estimado ML vs histórico por activo (Paso 2)</strong>
                    <span className="p-panel-sub">
                      · pronóstico IA + historia real = rendimiento anual usado (mezcla 50% / 50%)
                    </span>
                  </div>
                  <div className="ml-dense-table-wrap">
                    <table className="terminal-dense-table">
                      <thead>
                        <tr>
                          <th>ACTIVO</th>
                          <th className="num">REND. ML</th>
                          <th className="num">HISTÓRICO</th>
                          <th className="num">USADO</th>
                          <th className="num">VOLATILIDAD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activosLista.map((a) => (
                          <tr key={`p2_${a.sym}`}>
                            <td>
                              <strong>{String(a.sym || '').replace('_USDT', '')}</strong>{' '}
                              <span className="text-sec">{a.nombre}</span>
                            </td>
                            <td
                              className={`num ${
                                Number(a.rend_ml || 0) >= 0 ? 'text-green' : 'text-red'
                              }`}
                            >
                              {a.rend_ml !== undefined ? fmtSignedPct(a.rend_ml, 1) : '—'}
                            </td>
                            <td className="num text-sec">
                              {a.rend_hist !== undefined ? fmtSignedPct(a.rend_hist, 1) : '—'}
                            </td>
                            <td
                              className={`num ${
                                Number(a.rend_usado || 0) >= 0 ? 'text-green' : 'text-red'
                              }`}
                            >
                              <strong>{fmtSignedPct(a.rend_usado, 1)}</strong>
                            </td>
                            <td className="num">{fmtNum(a.volatilidad, 1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Validación Opción 2 */}
                {mlRend && (
                  <div className="portafolio-panel-card">
                    <div className="p-panel-head" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <strong>Opción 2 — Rendimiento a 20 días (regresión)</strong>
                        <div className="p-panel-sub">
                          Pronóstico de rendimiento acumulado a 20 días hábiles
                        </div>
                      </div>
                      {mejorRendFila && (
                        <span
                          className={`ml-verdict-pill ${claseVeredictoDM(
                            mejorRendFila.dm,
                            mejorRendFila.p
                          )}`}
                        >
                          {fraseVeredictoDM(mejorRendFila.dm, mejorRendFila.p)}
                        </span>
                      )}
                    </div>

                    {mejorRendFila && (
                      <div className="ml-hero-callout" style={{ marginBottom: '10px' }}>
                        <strong>{fraseVeredictoDM(mejorRendFila.dm, mejorRendFila.p)}</strong> ·
                        Mejor regresor: <strong>{mejorRendFila.modelo}</strong> (RMSE{' '}
                        <span className="num">{fmtNum(mejorRendFila.rmse, 2)}%</span> vs{' '}
                        <span className="num">{fmtNum(mlRend.base?.rmse, 2)}%</span> del ingenuo ·
                        DM <span className="num">{fmtNum(mejorRendFila.dm, 2)}</span>, p ={' '}
                        <span className="num">{fmtNum(mejorRendFila.p, 3)}</span>).
                      </div>
                    )}

                    <div className="ml-plain-guide">
                      <span>
                        <strong>En palabras sencillas:</strong> <strong>KNN Regressor</strong> busca
                        los 100 días históricos más cercanos mediante{' '}
                        <strong>Distancia Euclidiana</strong> <code>d(x, xᵢ)</code> ponderada por
                        cercanía · <strong>RMSE, MSE y MAE</strong> miden cuántos puntos
                        porcentuales se equivoca el pronóstico (más cerca de 0 = mejor) ·{' '}
                        <strong>MAPE y SMAPE</strong> miden ese error en % ·{' '}
                        <strong>VAR. SCORE</strong> indica qué tanto del movimiento explica el
                        modelo · <strong>DIR. %</strong> es el % de veces que acertó si subía o
                        bajaba.
                      </span>
                    </div>

                    <div className="ml-dense-table-wrap">
                      <table className="terminal-dense-table">
                        <thead>
                          <tr>
                            <th>MODELO</th>
                            <th className="num">RMSE</th>
                            <th className="num">MSE</th>
                            <th className="num">MAE</th>
                            <th className="num">MAPE</th>
                            <th className="num">SMAPE</th>
                            <th className="num">VAR. SCORE</th>
                            <th className="num">DIR. %</th>
                            <th className="num">DM</th>
                            <th className="num">P</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(mlRend.modelos || []).map((m, idx) => {
                            const esMejor = idx === idxMejorRend;
                            const dm = Number(m.dm || 0);
                            const vs = Number(m.variance_score ?? m.r2 ?? 0);
                            const { mape: mapeVal, smape: smapeVal } = obtenerMapeSmapeModelo(m);
                            return (
                              <tr
                                key={m.modelo}
                                className={esMejor ? 'ml-purple-best-row' : ''}
                              >
                                <td>
                                  <strong>{m.modelo}</strong>
                                </td>
                                <td className="num">{fmtNum(m.rmse, 2)}</td>
                                <td className="num">{fmtNum(m.mse, 2)}</td>
                                <td className="num">{fmtNum(m.mae, 2)}</td>
                                <td className="num">{fmtNum(mapeVal, 2)}%</td>
                                <td className="num">{fmtNum(smapeVal, 2)}%</td>
                                <td className={`num ${vs < 0 ? 'text-red' : ''}`}>
                                  {fmtNum(vs, 3)}
                                </td>
                                <td className="num">{fmtNum(m.acierto_direccion, 1)}%</td>
                                <td className={`num ${dm < 0 ? 'text-green' : 'text-red'}`}>
                                  {dm >= 0 ? '+' : ''}
                                  {fmtNum(dm, 2)}
                                </td>
                                <td className="num">{fmtNum(m.p, 3)}</td>
                              </tr>
                            );
                          })}
                          {mlRend.base && (() => {
                            const { mape: baseMape, smape: baseSmape } = obtenerMapeSmapeModelo(
                              mlRend.base
                            );
                            return (
                              <tr className="text-sec">
                                <td>{mlRend.base.modelo || 'Ingenuo (promedio histórico)'}</td>
                                <td className="num">{fmtNum(mlRend.base.rmse, 2)}</td>
                                <td className="num">
                                  {mlRend.base.mse !== undefined
                                    ? fmtNum(mlRend.base.mse, 2)
                                    : fmtNum(Math.pow(Number(mlRend.base.rmse || 0), 2), 2)}
                                </td>
                                <td className="num">{fmtNum(mlRend.base.mae, 2)}</td>
                                <td className="num">{fmtNum(baseMape, 2)}%</td>
                                <td className="num">{fmtNum(baseSmape, 2)}%</td>
                                <td className="num">
                                  {fmtNum(mlRend.base.variance_score ?? 0, 3)}
                                </td>
                                <td className="num">—</td>
                                <td className="num">—</td>
                                <td className="num">—</td>
                              </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>

                    <p className="portafolio-val-footnote">
                      RMSE/MSE/MAE en puntos porcentuales de rendimiento; MAPE y SMAPE expresados en
                      porcentaje sobre el precio proyectado a 20 días.
                      <br />
                      {NOTA_EXPLICACION_DM}
                    </p>

                    <MatrizConfusion
                      titulo="Matriz de confusión 2×2 de dirección (baja / sube)"
                      subtitulo="filas = dirección real · columnas = predicha"
                      etiquetas={mlRend.etiquetas_direccion || ['baja', 'sube']}
                      matriz={mlRend.matriz_direccion}
                      cols2
                      prefix="dir"
                    />
                  </div>
                )}

                {!verTodo && (
                  <div className="paso-footer-actions">
                    <button
                      type="button"
                      className="portafolio-next-btn"
                      onClick={() => irAPaso(3)}
                    >
                      <span>Continuar al Paso 3</span>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* PASO 3 · OPTIMIZAMOS TU CARTERA */}
      {!calculando && mostrarPaso3 && paso3Expandido && (
        <section
          ref={paso3Ref}
          id="paso-3-optimizacion"
          className="paso-shell paso-enter is-expanded"
        >
          <div className="paso-content-stack paso-stagger">
            <div className="portafolio-step-card">
              <div className="step-card-head">
                <span className="step-badge num">3</span>
                <strong>Optimizamos la cartera (Markowitz)</strong>
              </div>
              <p className="step-card-desc">
                Armamos las <strong>5 mejores combinaciones (carteras)</strong> buscando el mayor
                rendimiento con el menor riesgo posible (Recomendada, Máximo Sharpe, Mínima
                varianza, Paridad de riesgo y Pesos iguales 1/N), sin poner más de{' '}
                <span className="num">{Math.round(maxPeso * 100)}%</span> de tu dinero en un solo
                activo. Haz clic en cualquiera de las 5 tarjetas para explorar su composición o
                invertirla.
              </p>
            </div>

            {/* 5 Carteras (Recomendada primero con count-up 600ms) */}
            <section className="portafolio-cards-grid5">
              {carterasTodas.map((c, idx) => {
                const esTarjetaRec = String(c.nombre || '')
                  .toLowerCase()
                  .startsWith('recomendada');
                return (
                  <TarjetaCartera
                    key={c.nombre || idx}
                    c={c}
                    idx={idx}
                    esTarjetaRec={esTarjetaRec}
                    esActiva={idx === carteraActivaIdx}
                    coincideNombre={coincideNombre}
                    animarCifras={esTarjetaRec}
                    onSelect={() => setCarteraActivaIdx(idx)}
                  />
                );
              })}
            </section>

            {/* Frontera eficiente + Dona con barras animadas + Prueba fuera de muestra */}
            <section className="portafolio-bottom-grid3">
              {/* Frontera eficiente */}
              <div className="portafolio-panel-card">
                <div className="p-panel-head">
                  <strong>Frontera eficiente</strong>
                  <span className="p-panel-sub">
                    · Mapa Riesgo vs. Ganancia (más arriba = mayor ganancia, más a la izquierda =
                    menor riesgo)
                  </span>
                </div>

                <div className="frontera-svg-wrap">
                  <svg
                    viewBox={`0 0 ${fronteraGrafico.W} ${fronteraGrafico.H}`}
                    className="frontera-svg"
                  >
                    {fronteraGrafico.yTicks.map((yt) => {
                      const y = fronteraGrafico.yPos(yt);
                      return (
                        <g key={`y_${yt}`}>
                          <line
                            x1={fronteraGrafico.pad.l}
                            y1={y}
                            x2={fronteraGrafico.W - fronteraGrafico.pad.r}
                            y2={y}
                            stroke="#151522"
                            strokeWidth="1"
                          />
                          <text
                            x={fronteraGrafico.pad.l - 8}
                            y={y + 3}
                            textAnchor="end"
                            fill="#64748B"
                            fontSize="10"
                            fontFamily="var(--font-num)"
                          >
                            {yt}%
                          </text>
                        </g>
                      );
                    })}

                    {fronteraGrafico.xTicks.map((xt) => {
                      const x = fronteraGrafico.xPos(xt);
                      return (
                        <text
                          key={`x_${xt}`}
                          x={x}
                          y={fronteraGrafico.H - 8}
                          textAnchor="middle"
                          fill="#64748B"
                          fontSize="10"
                          fontFamily="var(--font-num)"
                        >
                          {xt}%
                        </text>
                      );
                    })}

                    {fronteraGrafico.nubeAzar.map((pt) => (
                      <circle
                        key={pt.id}
                        cx={pt.cx}
                        cy={pt.cy}
                        r="1.7"
                        fill="#4C4668"
                        opacity="0.55"
                      />
                    ))}

                    {fronteraGrafico.puntosActivos.map((a) => (
                      <g
                        key={a.sym}
                        onMouseEnter={() => setActivoHover(a)}
                        onMouseLeave={() => setActivoHover(null)}
                        style={{ cursor: 'pointer' }}
                      >
                        <circle
                          cx={a.cx}
                          cy={a.cy}
                          r="3.2"
                          fill="#64748B"
                          opacity="0.75"
                        />
                      </g>
                    ))}

                    <polyline
                      fill="none"
                      stroke="#8B5CF6"
                      strokeWidth="2.2"
                      points={fronteraGrafico.curvaPts}
                    />

                    {fronteraGrafico.puntosCarteras.map((p) => (
                      <g
                        key={p.etiqueta}
                        onClick={() => setCarteraActivaIdx(p.idx)}
                        style={{ cursor: 'pointer' }}
                      >
                        <circle
                          cx={p.cx}
                          cy={p.cy}
                          r="4.8"
                          fill={p.color}
                          stroke="#0B0B12"
                          strokeWidth="1.5"
                        />
                        <text
                          x={p.lx}
                          y={p.ly}
                          fill={p.color}
                          fontSize="10.5"
                          fontWeight="600"
                          fontFamily="var(--font-ui)"
                        >
                          {p.etiqueta}
                        </text>
                      </g>
                    ))}

                    {activoHover && (
                      <g>
                        <rect
                          x={Math.min(fronteraGrafico.W - 140, Math.max(46, activoHover.cx - 60))}
                          y={Math.max(12, activoHover.cy - 28)}
                          width="125"
                          height="20"
                          rx="4"
                          fill="#141422"
                          stroke="#8B5CF6"
                        />
                        <text
                          x={Math.min(fronteraGrafico.W - 78, Math.max(108, activoHover.cx + 2))}
                          y={Math.max(25, activoHover.cy - 15)}
                          textAnchor="middle"
                          fill="#F8FAFC"
                          fontSize="10"
                          fontFamily="var(--font-ui)"
                        >
                          {activoHover.sym.replace('_USDT', '')} ·{' '}
                          {fmtNum(activoHover.volatilidad, 1)}%
                        </text>
                      </g>
                    )}
                  </svg>
                </div>
              </div>

              {/* ¿En qué se invierte? + Barras animadas de pesos */}
              <div className="portafolio-panel-card">
                <div className="p-panel-head" style={{ justifyContent: 'space-between' }}>
                  <strong>¿En qué se invierte?</strong>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="mercado-ia-btn"
                      disabled={analizandoIA}
                      onClick={handleExplicarIA}
                    >
                      {analizandoIA ? 'Consultando...' : 'Explicar con IA'}
                    </button>
                    <button
                      type="button"
                      className="mercado-ia-btn primary"
                      disabled={invirtiendo}
                      onClick={() => setModalInvertir(true)}
                    >
                      Invertir cartera
                    </button>
                  </div>
                </div>

                <div className="dona-container">
                  <svg viewBox="0 0 180 180" className="dona-svg">
                    {pesosDona.map((item) => {
                      const R = 64;
                      const C = 2 * Math.PI * R;
                      const len = Math.max(0, (item.fin - item.ini) * C);
                      const offset = -item.ini * C;
                      return (
                        <circle
                          key={item.sym}
                          cx="90"
                          cy="90"
                          r={R}
                          fill="transparent"
                          stroke={item.color}
                          strokeWidth="22"
                          strokeDasharray={`${len} ${C}`}
                          strokeDashoffset={offset}
                          transform="rotate(-90 90 90)"
                        />
                      );
                    })}
                    <text
                      x="90"
                      y="86"
                      textAnchor="middle"
                      fill="#F8FAFC"
                      fontSize="14.5"
                      fontWeight="700"
                      fontFamily="var(--font-ui)"
                    >
                      {pesosDona.length} activos
                    </text>
                    <text
                      x="90"
                      y="104"
                      textAnchor="middle"
                      fill="#94A3B8"
                      fontSize="10.5"
                      fontFamily="var(--font-ui)"
                    >
                      {(carteraSeleccionada?.nombre || 'Máximo Sharpe').split(' (')[0]}
                    </text>
                  </svg>

                  <div className="dona-legend-2col">
                    {pesosDona.map((item) => (
                      <div key={item.sym} className="dona-legend-bar-item">
                        <div className="dona-legend-row">
                          <span className="dona-legend-left">
                            <span
                              className="dona-color-dot"
                              style={{ backgroundColor: item.color }}
                            />
                            <span className="dona-sym-name">{item.symCorto}</span>
                          </span>
                          <strong className="dona-sym-pct num">{item.pct.toFixed(1)}%</strong>
                        </div>
                        <div className="peso-bar-track" aria-hidden="true">
                          <div
                            className="peso-bar-fill"
                            style={{
                              width: `${Math.min(100, item.pct).toFixed(1)}%`,
                              backgroundColor: item.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Prueba fuera de muestra + VaR/CVaR */}
              <div className="portafolio-panel-card">
                <div className="p-panel-head">
                  <strong>Prueba fuera de muestra (vida real)</strong>
                  <span className="p-panel-sub">
                    {oos?.desde && oos?.hasta
                      ? `(${oos.desde} a ${oos.hasta})`
                      : '(último 30%)'}
                  </span>
                </div>

                <div className="oos-list">
                  <div className="oos-row">
                    <span className="oos-lbl">Con ML</span>
                    <strong
                      className={`oos-val num ${
                        Number(oos?.sharpe_con_ml ?? 0) >= 0 ? 'text-green' : 'text-red'
                      }`}
                    >
                      {sharpeML !== null ? `Sharpe ${fmtNum(sharpeML, 2)} · ` : ''}
                      {oos?.sharpe_con_ml !== undefined
                        ? fmtSignedPct(oos.sharpe_con_ml, 1)
                        : '—'}
                    </strong>
                  </div>
                  <div className="oos-row">
                    <span className="oos-lbl">Solo histórico</span>
                    <strong className="oos-val num">
                      {sharpeHist !== null ? `Sharpe ${fmtNum(sharpeHist, 2)} · ` : ''}
                      {oos?.sharpe_historico !== undefined
                        ? fmtSignedPct(oos.sharpe_historico, 1)
                        : '—'}
                    </strong>
                  </div>
                  <div className="oos-row">
                    <span className="oos-lbl">Mínima varianza</span>
                    <strong className="oos-val num">
                      {sharpeMinVar !== null ? `Sharpe ${fmtNum(sharpeMinVar, 2)} · ` : ''}
                      {oos?.minima_varianza !== undefined
                        ? fmtSignedPct(oos.minima_varianza, 1)
                        : '—'}
                    </strong>
                  </div>
                  {oos?.paridad_riesgo !== undefined && (
                    <div className="oos-row">
                      <span className="oos-lbl">Paridad de riesgo</span>
                      <strong className="oos-val num">
                        {sharpeParidad !== null ? `Sharpe ${fmtNum(sharpeParidad, 2)} · ` : ''}
                        {fmtSignedPct(oos.paridad_riesgo, 1)}
                      </strong>
                    </div>
                  )}
                  <div className="oos-row">
                    <span className="oos-lbl">Pesos iguales</span>
                    <strong className="oos-val num">
                      {sharpe1N !== null ? `Sharpe ${fmtNum(sharpe1N, 2)} · ` : ''}
                      {oos?.pesos_iguales !== undefined
                        ? fmtSignedPct(oos.pesos_iguales, 1)
                        : '—'}
                    </strong>
                  </div>
                  <div className="oos-row">
                    <span className="oos-lbl">S&amp;P 500 (SPY)</span>
                    <strong className="oos-val num">
                      {sharpeSpy !== null ? `Sharpe ${fmtNum(sharpeSpy, 2)} · ` : ''}
                      {oos?.spy !== undefined ? fmtSignedPct(oos.spy, 1) : '—'}
                    </strong>
                  </div>
                </div>

                <div className="oos-callout-box">
                  {mlSuperaSpyOos === true ? (
                    <>
                      En el periodo de prueba fuera de muestra, la cartera <strong>Con ML</strong> (
                      <span className="num">{fmtSignedPct(oos?.sharpe_con_ml, 1)}</span>) superó al{' '}
                      <strong>S&amp;P 500</strong> (
                      <span className="num">{fmtSignedPct(oos?.spy, 1)}</span>).
                    </>
                  ) : mlSuperaSpyOos === false ? (
                    <>
                      En el periodo de prueba fuera de muestra, el <strong>S&amp;P 500</strong>{' '}
                      obtuvo mayor rendimiento acumulado (
                      <strong className="num">{fmtSignedPct(oos?.spy, 1)}</strong>) que la cartera{' '}
                      <strong>Con ML</strong> (
                      <strong className="num">{fmtSignedPct(oos?.sharpe_con_ml, 1)}</strong>
                      {mlSuperaHistOos && oos?.sharpe_historico !== undefined
                        ? `, aunque Con ML superó a Solo histórico con ${fmtSignedPct(oos.sharpe_historico, 1)}`
                        : ''}
                      ) al diversificar en activos defensivos y topes de riesgo.
                    </>
                  ) : (
                    <>
                      Recalcula el portafolio para obtener los rendimientos y Sharpe reales fuera de
                      muestra.
                    </>
                  )}{' '}
                  Con un capital de ${fmtNum(capNum, 0)}, el VaR 95% indica que en un día malo (1 de
                  cada 20) podrías perder alrededor de ${perdidaDiaMaloUSD} (CVaR 95% día:{' '}
                  <span className="num">
                    {fmtNum(
                      carteraSeleccionada?.cvar95_dia ?? var95Ref * 1.32,
                      2
                    )}
                    %
                  </span>
                  ).
                </div>
              </div>
            </section>

            {/* Tabla de pesos de la cartera seleccionada (con barras animadas en peso %) */}
            <div className="portafolio-panel-card">
              <div className="p-panel-head">
                <strong>Pesos de la cartera seleccionada</strong>
                <span className="p-panel-sub">· {carteraSeleccionada?.nombre}</span>
              </div>
              <div className="ml-dense-table-wrap">
                <table className="terminal-dense-table">
                  <thead>
                    <tr>
                      <th>ACTIVO</th>
                      <th>CLASE</th>
                      <th>RÉGIMEN</th>
                      <th className="num">PESO %</th>
                      <th className="num">MONTO USD</th>
                      <th className="num">PRECIO</th>
                      <th className="num">CANTIDAD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pesosDona.map((p) => {
                      const reg = String(p.regimen || 'media').toLowerCase();
                      return (
                        <tr key={p.sym}>
                          <td>
                            <strong>{p.symCorto}</strong>{' '}
                            <span className="text-sec">{p.nombreLargo}</span>
                          </td>
                          <td className="text-sec">{p.clase}</td>
                          <td>
                            <span
                              className={`dense-side-pill ${
                                reg === 'baja' ? 'long' : reg === 'alta' ? 'short' : 'spot'
                              }`}
                            >
                              {reg.toUpperCase()}
                            </span>
                          </td>
                          <td className="num">
                            <div className="peso-table-cell">
                              <strong>{fmtNum(p.pct, 1)}%</strong>
                              <span className="peso-bar-track mini" aria-hidden="true">
                                <span
                                  className="peso-bar-fill"
                                  style={{
                                    width: `${Math.min(100, p.pct).toFixed(1)}%`,
                                    backgroundColor: p.color,
                                  }}
                                />
                              </span>
                            </div>
                          </td>
                          <td className="num">${fmtNum(p.montoUSD, 2)}</td>
                          <td className="num">${fmtNum(p.precioVivo, 2)}</td>
                          <td className="num">{fmtNum(p.cantidadEst, 4)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Matriz de Correlación de Pearson (Markowitz / Opción 6.2) */}
            {(() => {
              const pearson = construirMatrizPearson(
                pesosDona,
                portafolioData?.correlacion_pearson || portafolioData?.correlacion || null
              );
              if (!pearson) {
                return (
                  <div className="portafolio-panel-card">
                    <div className="p-panel-head">
                      <strong>
                        Matriz de Correlación de Pearson (ρ<sub>ij</sub>)
                      </strong>
                      <span className="p-panel-sub">
                        · Recalcula este portafolio para que el bot guarde la matriz de correlación
                        real calculada sobre los rendimientos diarios históricos.
                      </span>
                    </div>
                  </div>
                );
              }
              return (
                <div className="portafolio-panel-card">
                  <div className="p-panel-head" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <strong>
                        Matriz de Correlación de Pearson (ρ<sub>ij</sub>) entre los activos de tu
                        cartera
                      </strong>
                      <div className="p-panel-sub">
                        · Markowitz usa la covarianza <code>Σᵢⱼ = ρᵢⱼ · σᵢ · σⱼ</code> para
                        combinar activos descorrelacionados y bajar el riesgo total
                      </div>
                    </div>
                    <span className="pill-purple num">
                      Correlación media ρ̄ = {pearson.promedio >= 0 ? '+' : ''}
                      {pearson.promedio.toFixed(2)}
                    </span>
                  </div>

                  <div className="ml-plain-guide" style={{ marginBottom: '10px' }}>
                    <span>
                      <strong>¿Cómo se lee?</strong> Va de <strong className="num">−1.00</strong>{' '}
                      (se mueven en sentido contrario: protegen la cartera cuando otra parte cae,
                      ej. bonos TLT vs acciones) hasta <strong className="num">+1.00</strong> (suben
                      y bajan juntos). Combinar activos con baja correlación o negativa reduce la
                      volatilidad sin sacrificar rendimiento.
                    </span>
                  </div>

                  <div className="ml-dense-table-wrap">
                    <table className="terminal-dense-table">
                      <thead>
                        <tr>
                          <th>ACTIVO</th>
                          {pearson.items.map((col) => (
                            <th key={`pc_h_${col.sym}`} className="num">
                              {col.symCorto}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pearson.items.map((row, rIdx) => (
                          <tr key={`pc_r_${row.sym}`}>
                            <td>
                              <strong>{row.symCorto}</strong>
                            </td>
                            {pearson.matrix[rIdx].map((rho, cIdx) => {
                              const esDiag = rIdx === cIdx;
                              const abs = Math.min(1, Math.abs(rho));
                              const bg = esDiag
                                ? 'rgba(139, 92, 246, 0.25)'
                                : rho < 0
                                  ? `rgba(34, 197, 94, ${(0.08 + abs * 0.24).toFixed(2)})`
                                  : rho >= 0.7
                                    ? `rgba(239, 68, 68, ${(0.08 + (rho - 0.5) * 0.3).toFixed(2)})`
                                    : 'rgba(148, 163, 184, 0.06)';
                              return (
                                <td
                                  key={`pc_c_${rIdx}_${cIdx}`}
                                  className={`num ${
                                    esDiag
                                      ? 'text-accent'
                                      : rho < 0
                                        ? 'text-green'
                                        : rho >= 0.75
                                          ? 'text-red'
                                          : ''
                                  }`}
                                  style={{ backgroundColor: bg }}
                                >
                                  {esDiag ? '1.00' : `${rho > 0 ? '+' : ''}${rho.toFixed(2)}`}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* Comentario de Gemini (Explicar con IA) */}
            {(analizandoIA || respuestaIA) && (
              <section className="portafolio-panel-card portafolio-ia-comment">
                <div className="p-panel-head" style={{ justifyContent: 'space-between' }}>
                  <strong>Comentario de Gemini sobre tu Portafolio ML</strong>
                  {!analizandoIA && (
                    <button
                      type="button"
                      className="dense-close-btn"
                      onClick={() => setRespuestaIA('')}
                    >
                      Cerrar
                    </button>
                  )}
                </div>
                <p className="portafolio-ia-text">
                  {analizandoIA
                    ? 'Enviando contexto del portafolio, regímenes de volatilidad y métricas a Gemini...'
                    : respuestaIA}
                </p>
              </section>
            )}

            {/* Acceso rápido a portafolios ya invertidos cuando el usuario está en Paso 3 */}
            {portafoliosGuardados.length > 0 && (
              <section className="mis-pf-paso3-banner">
                <div>
                  <strong>
                    Tienes {portafoliosGuardados.length}{' '}
                    {portafoliosGuardados.length === 1
                      ? 'portafolio invertido'
                      : 'portafolios invertidos'}
                  </strong>
                  <span className="text-sec">
                    {' '}
                    · Al invertir esta cartera se guardará como{' '}
                    <strong>Portafolio {siguienteNumeroPortafolio}</strong> y se sumarán sus pesos.
                  </span>
                </div>
                <button
                  type="button"
                  className="paso-secondary-btn compact"
                  onClick={() => {
                    setMisPortafoliosExpandido(true);
                    requestAnimationFrame(() => {
                      misPortafoliosRef.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                    });
                  }}
                >
                  Ver mis portafolios arriba ↑
                </button>
              </section>
            )}

            {/* Botones finales: Recalcular + Empezar de nuevo */}
            <div className="paso-footer-actions between">
              <button
                type="button"
                className="paso-secondary-btn"
                disabled={calculando}
                onClick={handleEmpezarDeNuevo}
              >
                <RotateCcw size={14} />
                <span>Empezar de nuevo</span>
              </button>
              <button
                type="button"
                className="portafolio-next-btn"
                disabled={calculando}
                onClick={handleCalcular}
              >
                <Sparkles size={15} />
                <span>{calculando ? 'Calculando...' : 'Recalcular'}</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* MODAL DE CONFIRMACIÓN PARA INVERTIR LA CARTERA EN LA CUENTA */}
      {modalInvertir && carteraSeleccionada && (
        <div className="onb-overlay" role="dialog" aria-modal="true">
          <div className="panel onb-modal" style={{ maxWidth: '590px' }}>
            <div className="modal-pf-head">
              <h3>Confirmar inversión — {carteraSeleccionada.nombre}</h3>
              <span className="mis-pf-num-pill num">
                Se guardará como Portafolio {siguienteNumeroPortafolio}
              </span>
            </div>
            <p className="text-sec" style={{ fontSize: '12.5px', margin: '6px 0 10px' }}>
              Se abrirán{' '}
              <strong className="num">{pesosDona.length} posiciones Spot</strong> con origen{' '}
              <code>Portafolio {siguienteNumeroPortafolio}</code> por un total de{' '}
              <strong className="num">
                ${fmtNum(Math.min(capNum, efectivo), 2)} USD
              </strong>{' '}
              (efectivo disponible:{' '}
              <span className="num">${fmtNum(efectivo, 2)} USD</span>):
            </p>
            {capNum > efectivo && (
              <p className="modal-pf-warn">
                El capital configurado (${fmtNum(capNum, 0)}) supera tu efectivo disponible; se
                invertirá proporcionalmente el máximo disponible (${fmtNum(efectivo, 2)} USD).
              </p>
            )}
            <div className="ml-dense-table-wrap" style={{ maxHeight: '220px', overflowY: 'auto' }}>
              <table className="terminal-dense-table">
                <thead>
                  <tr>
                    <th>ACTIVO</th>
                    <th className="num">PESO</th>
                    <th className="num">PRECIO VIVO</th>
                    <th className="num">MONTO USD</th>
                  </tr>
                </thead>
                <tbody>
                  {pesosDona.map((item) => {
                    const montoAjustado =
                      Math.min(capNum, efectivo) * Number(item.peso || 0);
                    return (
                      <tr key={item.sym}>
                        <td>
                          <strong>{item.symCorto}</strong>{' '}
                          <span className="text-sec">{item.nombreLargo}</span>
                        </td>
                        <td className="num">{item.pct.toFixed(1)}%</td>
                        <td className="num">${fmtNum(item.precioVivo, 2)}</td>
                        <td className="num">${fmtNum(montoAjustado, 2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <label className="modal-pf-ctx-field">
              <span>
                Contexto / nota para Portafolio {siguienteNumeroPortafolio} (opcional)
              </span>
              <textarea
                rows={2}
                className="modal-pf-ctx-input"
                maxLength={220}
                value={contextoInversion}
                onChange={(e) => setContextoInversion(e.target.value)}
                placeholder={
                  siguienteNumeroPortafolio === 1
                    ? 'Ej. Portafolio 1 base conservadora largo plazo — después agregaré Portafolio 2...'
                    : `Ej. Portafolio ${siguienteNumeroPortafolio} táctico para complementar Portafolio 1...`
                }
              />
            </label>

            <div className="onb-footer-actions" style={{ marginTop: '14px' }}>
              <button
                type="button"
                className="dense-close-btn"
                disabled={invirtiendo}
                onClick={() => setModalInvertir(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="portafolio-calc-btn"
                disabled={invirtiendo}
                onClick={handleInvertirCartera}
              >
                {invirtiendo
                  ? 'Invirtiendo...'
                  : `Confirmar e invertir Portafolio ${siguienteNumeroPortafolio}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
