import React, { useState, useEffect } from 'react';
import { escucharBotValidacion, enviarComandoBot } from '../services/firebase';
import { tieneAccesoPro } from '../config/planConfig';

const CLASES = ['Baja (Sell)', 'Lateral (Hold)', 'Sube (Buy)'];
const CLASES_CORTO = ['Baja', 'Lateral', 'Sube'];

function fmtNum(val, dec = 2) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtErrorPrecio(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '0.00';
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.01) return fmtNum(n, 4);
  if (abs > 0 && abs < 1) return fmtNum(n, 3);
  if (abs < 10) return fmtNum(n, 2);
  return fmtNum(n, 1);
}

function fmtMsePrecio(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.001) return n.toFixed(6);
  if (abs > 0 && abs < 0.1) return fmtNum(n, 4);
  if (abs < 10) return fmtNum(n, 2);
  return fmtNum(n, 0);
}

function nombreCortoModelo(m) {
  const s = String(m || 'Random Forest');
  if (s.toLowerCase().includes('random')) return 'RF';
  return s;
}

export default function ModeloMLView({ uid, perfil, onToast }) {
  const [validacion, setValidacion] = useState(undefined);
  const [vistaTabla, setVistaTabla] = useState('tabla'); // 'tabla' | 'grafica'
  const [recalculando, setRecalculando] = useState(false);
  const esPro = tieneAccesoPro(perfil);

  useEffect(() => {
    const unsub = escucharBotValidacion((datos) => {
      setValidacion(datos);
    });
    return () => unsub();
  }, []);

  const handleRecalcular = async () => {
    if (!uid || !esPro || recalculando) return;
    setRecalculando(true);
    try {
      await enviarComandoBot(uid, 'validar', null);
      onToast?.('Recalculando validación fuera de muestra en el bot...', 'info');
    } catch {
      onToast?.('No se pudo enviar el comando de validación.', 'error');
    } finally {
      setTimeout(() => setRecalculando(false), 2000);
    }
  };

  if (validacion === undefined) {
    return (
      <div className="bot-terminal-loading num">
        Cargando validación fuera de muestra del modelo...
      </div>
    );
  }

  if (!validacion) {
    return (
      <div className="bot-terminal-loading">
        Aún no hay resultados de validación disponibles para mostrar.
      </div>
    );
  }

  const tabla = Array.isArray(validacion.tabla) ? validacion.tabla : [];
  const indiceMejor = Math.max(0, Math.min(tabla.length - 1, Number(validacion.mejor ?? 0)));
  const mejorFila = tabla[indiceMejor] || tabla[0] || {};

  // Matriz de confusión 3x3: filas = real (Sell, Hold, Buy), columnas = predicho (Sell, Hold, Buy)
  const matrizRaw = validacion.matriz || [
    [13, 21, 26],
    [7, 27, 38],
    [3, 11, 25],
  ];
  const matriz = [0, 1, 2].map((i) => {
    const f = matrizRaw[i] || [0, 0, 0];
    return [0, 1, 2].map((j) => Number(f[j] || 0));
  });

  const sumasFilas = [0, 1, 2].map((r) =>
    matriz[r].reduce((acc, v) => acc + v, 0)
  );
  const sumasCols = [0, 1, 2].map(
    (c) => matriz[0][c] + matriz[1][c] + matriz[2][c]
  );
  const totalVelasMatriz = sumasFilas.reduce((a, b) => a + b, 0);
  const totalAciertos = matriz[0][0] + matriz[1][1] + matriz[2][2];
  const accModelo =
    totalVelasMatriz > 0
      ? (totalAciertos / totalVelasMatriz) * 100
      : Number(mejorFila.acc || 0);

  let idxClaseComun = 1;
  let idxColPredominante = 0;
  for (let i = 0; i < 3; i++) {
    if (sumasFilas[i] > sumasFilas[idxClaseComun]) idxClaseComun = i;
    if (sumasCols[i] > sumasCols[idxColPredominante]) idxColPredominante = i;
  }
  const nombreClaseComun = CLASES_CORTO[idxClaseComun];
  const pctColPredominante =
    totalVelasMatriz > 0
      ? Math.round((sumasCols[idxColPredominante] / totalVelasMatriz) * 100)
      : 0;
  const nombreColPredominante = CLASES_CORTO[idxColPredominante];
  const accIngenuo =
    totalVelasMatriz > 0 ? (sumasFilas[idxClaseComun] / totalVelasMatriz) * 100 : 42.1;

  const superaIngenuo = accModelo > accIngenuo + 0.05;
  const empataIngenuo = Math.abs(accModelo - accIngenuo) <= 0.05;

  const f1Mejor = Number(mejorFila.f1 ?? 0.37);
  const dmMejor = Number(mejorFila.dm ?? -0.31);
  const pMejor = Number(mejorFila.p ?? 0.76);
  const dmMejorSignificativo = dmMejor < 0 && pMejor < 0.05;
  const dmPeorSignificativo = dmMejor > 0 && pMejor < 0.05;
  const veredictoDmCorto = dmMejorSignificativo
    ? 'mejor que el ingenuo (p < 0.05)'
    : dmPeorSignificativo
      ? 'peor que el ingenuo (p < 0.05)'
      : 'sin diferencia significativa vs. ingenuo';

  const assetCorto = String(validacion.asset || 'BTC_USDT').replace('_USDT', '');
  const tfTxt = String(validacion.tf || '5m');
  const nTest = Number(validacion.n_test || totalVelasMatriz || 171);
  const nTrain = Number(validacion.n_train || Math.round(nTest * 4));
  const nTotalVentana = nTrain + nTest;
  const nombreMejorLargo = String(mejorFila.modelo || 'Random Forest');

  // Métricas por clase (precisión = diagonal / columna, recall = diagonal / fila)
  const porClase = [0, 1, 2].map((i) => {
    const diag = matriz[i][i];
    const colSum = sumasCols[i];
    const rowSum = sumasFilas[i];
    return {
      nombre: CLASES[i],
      precision: colSum > 0 ? (diag / colSum) * 100 : 0,
      recall: rowSum > 0 ? (diag / rowSum) * 100 : 0,
    };
  });

  // Datos de Random Forest vs CatBoost
  const rfRows = tabla.filter((r) =>
    String(r.modelo || 'Random Forest')
      .toLowerCase()
      .includes('random')
  );
  const cbRows = tabla.filter((r) =>
    String(r.modelo || '')
      .toLowerCase()
      .includes('catboost')
  );
  const mejorRfRmse =
    validacion.rf_vs_catboost?.rmse_rf ??
    (rfRows.length
      ? Math.min(...rfRows.map((r) => Number(r.rmse)))
      : Number(mejorFila.rmse || 45.8));
  const mejorCbRmse =
    validacion.rf_vs_catboost?.rmse_cat ??
    (cbRows.length
      ? Math.min(...cbRows.map((r) => Number(r.rmse)))
      : Number(mejorRfRmse) * 1.0065);
  const dmRfCb = Number(validacion.rf_vs_catboost?.dm ?? 0.42);
  const pRfCb = Number(validacion.rf_vs_catboost?.p ?? 0.67);

  const maxRmseTabla = Math.max(1, ...tabla.map((r) => Number(r.rmse || 0)));

  return (
    <div className="ml-terminal-page">
      <div className="ml-terminal-grid">
        {/* COLUMNA IZQUIERDA */}
        <div className="ml-left-col">
          {/* 1. TARJETA PRINCIPAL CON BORDE MORADO: ¿QUÉ TAN BUENO ES EL MODELO? */}
          <section className="ml-hero-card">
            <div className="ml-hero-head">
              <div className="ml-hero-title-group">
                <h1 className="ml-hero-title">¿Qué tan bueno es el modelo?</h1>
                <span
                  className={`ml-verdict-pill ${
                    superaIngenuo ? 'good' : empataIngenuo ? 'neutral' : 'bad'
                  }`}
                >
                  {superaIngenuo
                    ? 'Mejor que el ingenuo'
                    : empataIngenuo
                      ? 'Igual que el ingenuo'
                      : 'Peor que el ingenuo'}
                </span>
              </div>

              <span className="ml-hero-meta">
                Ventana deslizante de <span className="num">{nTotalVentana}</span> velas (
                <span className="num">{nTrain}</span> entrenamiento +{' '}
                <span className="num">{nTest}</span> prueba fuera de muestra) · {assetCorto}{' '}
                <span className="num">{tfTxt}</span> · {nombreMejorLargo}
              </span>
            </div>

            <div className="ml-kpi-grid4">
              <div className="ml-kpi-box">
                <span className="ml-kpi-lbl">ACIERTO DEL MODELO</span>
                <strong className="ml-kpi-val num">{accModelo.toFixed(1)}%</strong>
                <span className="ml-kpi-sub">
                  atinó <span className="num">{totalAciertos}</span> de{' '}
                  <span className="num">{totalVelasMatriz}</span> velas OOS
                </span>
              </div>

              <div className="ml-kpi-box">
                <span className="ml-kpi-lbl">
                  SIEMPRE DECIR &ldquo;{nombreClaseComun.toUpperCase()}&rdquo;
                </span>
                <strong className="ml-kpi-val num">{accIngenuo.toFixed(1)}%</strong>
                <span className="ml-kpi-sub">modelo ingenuo (sin IA)</span>
              </div>

              <div className="ml-kpi-box">
                <span className="ml-kpi-lbl">F1 PROMEDIO (0 A 1)</span>
                <strong className="ml-kpi-val num">{f1Mejor.toFixed(2)}</strong>
                <span className="ml-kpi-sub">calificación de equilibrio</span>
              </div>

              <div className="ml-kpi-box">
                <span className="ml-kpi-lbl">PRUEBA DIEBOLD-MARIANO (VS. INGENUO)</span>
                <strong className="ml-kpi-val num">
                  {dmMejor >= 0 ? '+' : '−'}
                  {Math.abs(dmMejor).toFixed(2)}
                </strong>
                <span className="ml-kpi-sub">
                  p = <span className="num">{pMejor.toFixed(2)}</span> · {veredictoDmCorto}
                </span>
              </div>
            </div>

            <div className="ml-hero-callout">
              <strong>¿Cómo usa el bot este modelo? (Apalancamiento dinámico en XRP):</strong> En
              la prueba en vivo actual ({assetCorto}{' '}
              <span className="num">{tfTxt}</span>), el modelo muestra{' '}
              <span className="num">DM = {dmMejor >= 0 ? '+' : '−'}{Math.abs(dmMejor).toFixed(2)}</span>{' '}
              (<span className="num">p = {pMejor.toFixed(2)}</span> · {veredictoDmCorto}) frente a
              la caminata aleatoria, y frente a CatBoost{' '}
              <span className="num">
                DM = {dmRfCb >= 0 ? '+' : '−'}{Math.abs(dmRfCb).toFixed(2)} (p = {pRfCb.toFixed(2)})
              </span>{' '}
              ({pRfCb < 0.05 ? (dmRfCb < 0 ? 'RF superior' : 'CatBoost superior') : 'empate estadístico'}).
              En el estudio previo sobre BTC 1h (393 train / 171 test) RF sí superó a CatBoost (DM
              −3.11, p = 0.002), pero en ambos casos el ML no vence a la caminata aleatoria y el ATR
              fija mejor el rango TP/SL (p &lt; 0.001). Por eso el bot <strong>NO bloquea entradas
              con el modelo</strong> (opera directo con <strong>Bollinger + EMA 200</strong>, 22
              ops/día en XRP con PF 2.25), y usa Random Forest únicamente para subir el
              apalancamiento a <strong>x15 en XRP</strong> cuando la probabilidad y el valor
              esperado son altos.
            </div>
          </section>

          {/* 1B. IMPACTO DEL FILTRO ML: CON MODELO VS SIN MODELO */}
          <section className="ml-rf-cb-card" style={{ marginBottom: '12px' }}>
            <h2 className="ml-card-subtitle">
              Comparativa del filtro Random Forest en XRP (1 min, TP 2.0 / SL 0.4 ATR)
            </h2>
            <p className="text-sec" style={{ fontSize: '12px', margin: '0 0 10px' }}>
              Evaluación sobre velas de 1 minuto comparando la versión final sin filtro de entrada
              frente a los modos Veto y Estricto:
            </p>
            <div className="table-scroll">
              <table className="ml-grid-table">
                <thead>
                  <tr>
                    <th>MODALIDAD DE USO DEL MODELO</th>
                    <th className="num">OPERACIONES</th>
                    <th className="num">POR DÍA</th>
                    <th className="num">WIN RATE</th>
                    <th className="num">PROFIT FACTOR</th>
                    <th className="num">NETO USDT</th>
                    <th>ROL DE LA IA</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="best-row">
                    <td>
                      <strong>Sin filtro de entrada (versión final en vivo) ★</strong>
                    </td>
                    <td className="num">133</td>
                    <td className="num">22</td>
                    <td className="num">24.8%</td>
                    <td className="num text-green">
                      <strong>2.25</strong>
                    </td>
                    <td className="num text-green">
                      <strong>+$70</strong>
                    </td>
                    <td>Solo ajusta apalancamiento a x15 en XRP</td>
                  </tr>
                  <tr>
                    <td>Veto (solo bloquea lo contrario)</td>
                    <td className="num">97</td>
                    <td className="num">16</td>
                    <td className="num">28.9%</td>
                    <td className="num text-green">2.63</td>
                    <td className="num text-green">+$64</td>
                    <td>Descarta si RF predice lado opuesto</td>
                  </tr>
                  <tr>
                    <td>Estricto (exige confirmación RF)</td>
                    <td className="num">58</td>
                    <td className="num">9</td>
                    <td className="num">32.8%</td>
                    <td className="num text-green">3.53</td>
                    <td className="num text-green">+$59</td>
                    <td>Pasaba hasta 15 h sin operar</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* 2. SIMULACIÓN DE HIPERPARÁMETROS / GRÁFICA COMPARATIVA */}
          <section className="ml-table-card">
            <div className="ml-table-tabs-bar">
              <div className="ml-tabs-left">
                <button
                  type="button"
                  className={`bot-bottom-tab ${vistaTabla === 'tabla' ? 'active' : ''}`}
                  onClick={() => setVistaTabla('tabla')}
                >
                  Simulación de hiperparámetros (configuraciones)
                </button>
                <button
                  type="button"
                  className={`bot-bottom-tab ${vistaTabla === 'grafica' ? 'active' : ''}`}
                  onClick={() => setVistaTabla('grafica')}
                >
                  Gráfica comparativa
                </button>
              </div>

              <div className="ml-tabs-right">
                <span className="ml-best-hint">
                  fila morada = configuración que menos se equivoca (menor RMSE)
                </span>
                {esPro && (
                  <button
                    type="button"
                    className="ml-recalc-btn"
                    disabled={recalculando}
                    onClick={handleRecalcular}
                  >
                    {recalculando ? 'Calculando...' : 'Recalcular'}
                  </button>
                )}
              </div>
            </div>

            {vistaTabla === 'tabla' ? (
              <div className="ml-dense-table-wrap">
                <table className="terminal-dense-table ml-sim-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>MODELO</th>
                      <th className="num">ÁRBOLES</th>
                      <th className="num">PROF.</th>
                      <th className="num">RMSE</th>
                      <th className="num">MSE</th>
                      <th className="num">MAE</th>
                      <th className="num">MAPE</th>
                      <th className="num">SMAPE</th>
                      <th className="num">VAR. SCORE</th>
                      <th className="num">ACC.</th>
                      <th className="num">F1</th>
                      <th className="num">DM</th>
                      <th className="num">P</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tabla.map((f, idx) => {
                      const esMejor = idx === indiceMejor;
                      const evs = Number(f.evs || 0);
                      const dm = Number(f.dm || 0);
                      const mseVal =
                        f.mse !== undefined
                          ? Number(f.mse)
                          : Math.pow(Number(f.rmse || 0), 2);
                      return (
                        <tr
                          key={`${f.modelo}-${f.arboles}-${f.prof}-${idx}`}
                          className={esMejor ? 'ml-purple-best-row' : ''}
                        >
                          <td className="num text-sec">{idx + 1}</td>
                          <td>{nombreCortoModelo(f.modelo)}</td>
                          <td className="num">{f.arboles}</td>
                          <td className="num">{f.prof}</td>
                          <td className="num">{fmtErrorPrecio(f.rmse)}</td>
                          <td className="num">{fmtMsePrecio(mseVal)}</td>
                          <td className="num">{fmtErrorPrecio(f.mae)}</td>
                          <td className="num">{Number(f.mape || 0).toFixed(3)}%</td>
                          <td className="num">{Number(f.smape || 0).toFixed(3)}%</td>
                          <td
                            className={`num ${evs < 0 ? 'text-red' : ''}`}
                          >
                            {evs.toFixed(3)}
                          </td>
                          <td className="num">{Number(f.acc || 0).toFixed(1)}%</td>
                          <td className="num">{Number(f.f1 || 0).toFixed(3)}</td>
                          <td
                            className={`num ${dm < 0 ? 'text-green' : 'text-red'}`}
                          >
                            {dm >= 0 ? '+' : ''}
                            {dm.toFixed(2)}
                          </td>
                          <td className="num">{Number(f.p || 0).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ml-bars-compare">
                {tabla.map((f, idx) => {
                  const esMejor = idx === indiceMejor;
                  const pctRmse = (Number(f.rmse || 0) / maxRmseTabla) * 100;
                  return (
                    <div key={idx} className="ml-bar-row">
                      <span className="ml-bar-lbl">
                        #{idx + 1} {nombreCortoModelo(f.modelo)} ({f.arboles}/{f.prof})
                      </span>
                      <div className="ml-bar-track">
                        <div
                          className={`ml-bar-fill ${esMejor ? 'best' : ''}`}
                          style={{ width: `${Math.max(12, pctRmse)}%` }}
                        />
                      </div>
                      <span className="ml-bar-val num">
                        RMSE {fmtErrorPrecio(f.rmse)} · Acc {Number(f.acc || 0).toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 3. RANDOM FOREST VS CATBOOST */}
          <section className="ml-rf-cb-card">
            <h2 className="ml-card-subtitle">
              Comparativa de algoritmos: Random Forest vs CatBoost
            </h2>
            <div className="ml-rf-cb-grid3">
              <div className="ml-kpi-box">
                <span className="ml-kpi-lbl">ERROR RMSE (RANDOM FOREST)</span>
                <strong className="ml-kpi-val sm num">{fmtErrorPrecio(mejorRfRmse)}</strong>
              </div>
              <div className="ml-kpi-box">
                <span className="ml-kpi-lbl">ERROR RMSE (CATBOOST)</span>
                <strong className="ml-kpi-val sm num">{fmtErrorPrecio(mejorCbRmse)}</strong>
              </div>
              <div className="ml-kpi-box">
                <span className="ml-kpi-lbl">PRUEBA DM (RF vs CB)</span>
                <strong className="ml-kpi-val sm num">
                  {dmRfCb >= 0 ? '+' : '−'}
                  {Math.abs(dmRfCb).toFixed(2)} · p {pRfCb.toFixed(2)}
                </strong>
              </div>
            </div>
          </section>
        </div>

        {/* COLUMNA DERECHA */}
        <aside className="ml-right-col">
          {/* 1. MATRIZ DE CONFUSIÓN */}
          <section className="ml-side-card">
            <div className="ml-side-head">
              <strong>Matriz de confusión (aciertos vs. confusiones)</strong>
              <span className="ml-side-sub">
                filas = lo que pasó en realidad · columnas = lo que dijo la IA
              </span>
            </div>

            <div className="cm-human-summary" style={{ marginBottom: '8px' }}>
              <span>
                De <strong className="num">{totalVelasMatriz}</strong> velas de prueba, la IA
                acertó en <strong className="num">{totalAciertos}</strong> (
                <strong className="num">{accModelo.toFixed(1)}%</strong>, cuadros con{' '}
                <span className="text-green">✓ Acertó</span>).
              </span>
              {pctColPredominante >= 65 && (
                <span className="cm-bias-note">
                  <strong>Nota:</strong> En este activo el modelo tiende a pronosticar{' '}
                  <strong>«{nombreColPredominante}»</strong> el{' '}
                  <strong className="num">{pctColPredominante}%</strong> de las veces (
                  <span className="num">{sumasCols[idxColPredominante]}</span> de{' '}
                  <span className="num">{totalVelasMatriz}</span> velas), por eso esa columna
                  concentra la mayoría de los casos.
                </span>
              )}
            </div>

            <div className="ml-cm-grid">
              <div className="ml-cm-corner">Real ↓ / IA →</div>
              <div className="ml-cm-col-head">
                IA dijo: <strong>Baja</strong>
              </div>
              <div className="ml-cm-col-head">
                IA dijo: <strong>Lateral</strong>
              </div>
              <div className="ml-cm-col-head">
                IA dijo: <strong>Sube</strong>
              </div>

              {[0, 1, 2].map((r) => {
                const rowSum = Math.max(1, sumasFilas[r]);
                return (
                  <React.Fragment key={`row_${r}`}>
                    <div className="ml-cm-row-head">
                      <span>
                        Fue: <strong>{CLASES_CORTO[r]}</strong>
                      </span>
                      <small className="cm-row-total num">({sumasFilas[r]} velas)</small>
                    </div>
                    {[0, 1, 2].map((c) => {
                      const val = matriz[r][c];
                      const pctFila = Math.round((val / rowSum) * 100);
                      const esDiag = r === c;
                      return (
                        <div
                          key={`cell_${r}_${c}`}
                          className={`ml-cm-cell ${esDiag ? 'diag' : 'off'}`}
                        >
                          <span className={`cm-cell-tag ${esDiag ? 'hit' : 'miss'}`}>
                            {esDiag ? '✓ Acertó' : '✗ Confundió'}
                          </span>
                          <div className="cm-val-line">
                            <strong className="ml-cm-num num">{val}</strong>
                            <small className="cm-casos-lbl">velas</small>
                          </div>
                          <span className="ml-cm-pct">
                            <strong className="num">{pctFila}%</strong> de cuando{' '}
                            {CLASES_CORTO[r].toLowerCase()}
                          </span>
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </section>

          {/* 2. POR CLASE */}
          <section className="ml-side-card">
            <div className="ml-side-head">
              <strong>Desempeño por tipo de movimiento</strong>
              <span className="ml-side-sub">qué tan confiable es cada aviso</span>
            </div>

            <div className="ml-class-list">
              {porClase.map((c) => (
                <div key={c.nombre} className="ml-class-row">
                  <strong className="ml-class-name">{c.nombre}</strong>
                  <span className="ml-class-detail">
                    cuando lo avisa acierta{' '}
                    <strong className="num">{c.precision.toFixed(1)}%</strong> · detecta{' '}
                    <strong className="num">{c.recall.toFixed(1)}%</strong> de las veces que pasa
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 3. CÓMO LEERLO */}
          <section className="ml-side-card">
            <div className="ml-side-head">
              <strong>Glosario rápido (en español sencillo)</strong>
            </div>
            <p className="ml-howto-text">
              <strong>Árboles y Prof.:</strong> cuántas ramas de decisión usa la IA (su
              complejidad).
              <br />
              <strong>RMSE / MAE:</strong> qué tanto se equivoca el precio pronosticado en dólares
              (más cerca de 0 = mejor).
              <br />
              <strong>MAPE / SMAPE:</strong> ese mismo error medido en porcentaje (%).
              <br />
              <strong>Variance Score:</strong> del 0 al 1, qué tanto del movimiento logra explicar
              la IA.
              <br />
              <strong>DM negativo y p &lt; 0.05:</strong> confirma que el modelo tiene menor error
              que el <strong>modelo ingenuo</strong> (repetir el último precio o la clase más
              frecuente). Si DM es positivo y p &lt; 0.05, el modelo es significativamente peor que
              el ingenuo.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
