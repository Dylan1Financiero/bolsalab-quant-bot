import React, { useState, useEffect, useMemo, useCallback } from 'react';
import datosChartismo from '../data/figuras_chartismo.json';
import ChartismoCanvas from './ChartismoCanvas';
import {
  generarEscenarioFigura,
  calcularNivelUsuario,
} from '../utils/generadorVelasChartismo';
import {
  actualizarProgresoChartismo,
  escucharRanking,
} from '../services/firebase';

const FIGURAS = datosChartismo.figuras || [];
const NIVELES = datosChartismo.niveles || [];

function mezclarArreglo(arr) {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function elegirPreguntaAleatoria(idAnterior = null) {
  const candidatas =
    FIGURAS.length > 1 ? FIGURAS.filter((f) => f.id !== idAnterior) : FIGURAS;
  const correcta = candidatas[Math.floor(Math.random() * candidatas.length)];
  const distractoras = mezclarArreglo(
    FIGURAS.filter((f) => f.id !== correcta.id)
  ).slice(0, 3);
  const opciones = mezclarArreglo([correcta, ...distractoras]);
  const escenario = generarEscenarioFigura(correcta);

  return {
    figura: correcta,
    opciones,
    escenario,
  };
}

const NOMBRE_ROL = {
  resistencia: 'Resistencia',
  soporte: 'Soporte',
  cuello: 'Línea de cuello',
  fibonacci: 'Fibonacci',
};

const EXPLICACION_ROL = {
  resistencia: 'La resistencia une los máximos, no los cierres.',
  soporte: 'El soporte une los mínimos de la formación.',
  cuello: 'La línea de cuello conecta los puntos clave de ruptura.',
  fibonacci: 'Traza el nivel horizontal en el retroceso clave.',
};

function signoPendiente(v1, v2) {
  const prom = Math.max(1e-6, Math.abs((v1 + v2) / 2));
  if (Math.abs(v2 - v1) / prom < 0.005) return 0;
  return v2 > v1 ? 1 : -1;
}

function evaluarDibujoUsuario(lineasUsuario = [], lineasEscaladas = []) {
  if (!Array.isArray(lineasUsuario) || lineasUsuario.length === 0) {
    return { resultados: [], xpDibujo: 0 };
  }
  if (!Array.isArray(lineasEscaladas) || lineasEscaladas.length === 0) {
    return { resultados: [], xpDibujo: 0 };
  }

  let xpDibujo = 0;
  const resultados = lineasEscaladas.map((lin) => {
    const datos = lin.datos || [];
    const pIni = datos[0];
    const pFin = datos[datos.length - 1];
    if (!pIni || !pFin) {
      return {
        rol: lin.rol,
        nombre: NOMBRE_ROL[lin.rol] || lin.rol,
        ok: false,
        detalle: EXPLICACION_ROL[lin.rol] || 'Revisa los puntos clave.',
      };
    }

    const t0 = Number(pIni.time);
    const v0 = Number(pIni.value);
    const t1 = Number(pFin.time);
    const v1 = Number(pFin.value);
    const sigCorr = signoPendiente(v0, v1);

    let mejor = null;
    for (const u of lineasUsuario) {
      const ut0 = Number(u.p1.time);
      const uv0 = Number(u.p1.value);
      const ut1 = Number(u.p2.time);
      const uv1 = Number(u.p2.value);
      const span = Math.max(1, ut1 - ut0);
      const uEn = (t) => uv0 + ((uv1 - uv0) * (t - ut0)) / span;
      const tMid = (t0 + t1) / 2;
      const vMid = (v0 + v1) / 2;

      const d0 = Math.abs(uEn(t0) - v0) / Math.max(1e-6, Math.abs(v0));
      const dMid = Math.abs(uEn(tMid) - vMid) / Math.max(1e-6, Math.abs(vMid));
      const d1 = Math.abs(uEn(t1) - v1) / Math.max(1e-6, Math.abs(v1));
      const diffPct = ((d0 + dMid + d1) / 3) * 100;
      const sigUsr = signoPendiente(uv0, uv1);
      const mismaDir = sigUsr === sigCorr;

      if (!mejor || diffPct < mejor.diffPct) {
        mejor = { diffPct, mismaDir };
      }
    }

    const ok = Boolean(mejor && mejor.mismaDir && mejor.diffPct < 2);
    if (ok) {
      xpDibujo += 5;
      return {
        rol: lin.rol,
        nombre: NOMBRE_ROL[lin.rol] || lin.rol,
        ok: true,
        detalle: `✅ Bien trazada (+5 XP · desvío ${mejor.diffPct.toFixed(1)}%)`,
      };
    }

    const motivo = !mejor?.mismaDir
      ? 'Pendiente distinta a la línea clave.'
      : `Desvío promedio ${mejor.diffPct.toFixed(1)}% (debe ser < 2%).`;
    return {
      rol: lin.rol,
      nombre: NOMBRE_ROL[lin.rol] || lin.rol,
      ok: false,
      detalle: `⚠️ Revisa: ${EXPLICACION_ROL[lin.rol] || ''} ${motivo}`.trim(),
    };
  });

  return { resultados, xpDibujo };
}

export default function JuegoView({ uid, perfil, rendimientoPct = 0, onToast }) {
  const [modo, setModo] = useState('identifica'); // 'identifica' | 'direccion' | 'biblioteca'
  const [pregunta, setPregunta] = useState(() => elegirPreguntaAleatoria(null));
  const [respuestaUsuario, setRespuestaUsuario] = useState(null);
  const [ultimoXpGanado, setUltimoXpGanado] = useState(0);
  const [guardando, setGuardando] = useState(false);

  // Herramienta de dibujo en memoria (no se guarda en Firestore)
  const [herramientaDibujo, setHerramientaDibujo] = useState(null); // 'tendencia' | 'horizontal' | null
  const [lineasUsuario, setLineasUsuario] = useState([]);
  const [evaluacionDibujo, setEvaluacionDibujo] = useState(null);

  // Estado para modo Biblioteca
  const [figuraBiblioId, setFiguraBiblioId] = useState(FIGURAS[0]?.id || 'dobleTecho');
  const [semillaBiblio, setSemillaBiblio] = useState(0);

  // Ranking Top 10 por XP
  const [rankingTop, setRankingTop] = useState([]);

  useEffect(() => {
    const unsub = escucharRanking((items) => {
      setRankingTop(items);
    }, 10);
    return () => unsub();
  }, []);

  // Estadísticas del jugador desde perfil
  const xp = Number(perfil?.xp || 0);
  const aciertos = Number(perfil?.aciertos || 0);
  const intentos = Number(perfil?.intentos || 0);
  const racha = Number(perfil?.racha || 0);
  const rachaMax = Number(perfil?.rachaMax || 0);
  const pctAciertos = intentos > 0 ? ((aciertos / intentos) * 100).toFixed(1) : '0.0';

  const infoNivel = useMemo(() => calcularNivelUsuario(xp, NIVELES), [xp]);

  const siguientePregunta = useCallback(() => {
    setRespuestaUsuario(null);
    setUltimoXpGanado(0);
    setLineasUsuario([]);
    setEvaluacionDibujo(null);
    setHerramientaDibujo(null);
    setPregunta((prev) => elegirPreguntaAleatoria(prev?.figura?.id));
  }, []);

  const cambiarModo = (nuevoModo) => {
    setModo(nuevoModo);
    if (nuevoModo !== 'biblioteca') {
      setRespuestaUsuario(null);
      setUltimoXpGanado(0);
      setLineasUsuario([]);
      setEvaluacionDibujo(null);
      setHerramientaDibujo(null);
      setPregunta((prev) => elegirPreguntaAleatoria(prev?.figura?.id));
    }
  };

  // Manejar respuesta en Modo 1 ("identifica") o Modo 2 ("direccion")
  const manejarRespuesta = async (valorElegido) => {
    if (respuestaUsuario !== null || guardando) return;

    const fig = pregunta.figura;
    const esCorrecta =
      modo === 'identifica'
        ? valorElegido === fig.id
        : valorElegido === fig.direccion;

    setRespuestaUsuario(valorElegido);

    // Cálculo de XP y racha según Sección 5.3 + bono por dibujo (+5 XP por línea bien trazada):
    const evalDibujo = evaluarDibujoUsuario(
      lineasUsuario,
      pregunta.escenario?.lineasEscaladas || []
    );
    setEvaluacionDibujo(evalDibujo);
    setHerramientaDibujo(null);

    const nuevaRacha = esCorrecta ? racha + 1 : 0;
    const bonoRacha = esCorrecta ? Math.min(nuevaRacha - 1, 5) * 2 : 0;
    const xpGanado = (esCorrecta ? 10 + bonoRacha : 0) + evalDibujo.xpDibujo;
    const nuevoXp = xp + xpGanado;
    const nuevosAciertos = aciertos + (esCorrecta ? 1 : 0);
    const nuevosIntentos = intentos + 1;
    const nuevaRachaMax = Math.max(rachaMax, nuevaRacha);

    setUltimoXpGanado(xpGanado);

    if (!uid) return;
    setGuardando(true);
    try {
      await actualizarProgresoChartismo(uid, {
        xp: nuevoXp,
        aciertos: nuevosAciertos,
        intentos: nuevosIntentos,
        racha: nuevaRacha,
        rachaMax: nuevaRachaMax,
        nombre: perfil?.nombre || 'Estudiante',
        rend: Number(rendimientoPct.toFixed(2)),
      });
    } catch (err) {
      console.error('Error guardando progreso de chartismo:', err);
      if (onToast) onToast('No se pudo guardar el progreso en Firestore.', 'error');
    } finally {
      setGuardando(false);
    }
  };

  // Agrupación de las 38 figuras por `tipo` para la Biblioteca
  const gruposBiblioteca = useMemo(() => {
    const mapa = new Map();
    FIGURAS.forEach((f, idx) => {
      const tipo = f.tipo || 'Otras';
      if (!mapa.has(tipo)) mapa.set(tipo, []);
      mapa.get(tipo).push({ ...f, numero: idx + 1 });
    });
    return Array.from(mapa.entries());
  }, []);

  const figuraBiblio = useMemo(
    () => FIGURAS.find((f) => f.id === figuraBiblioId) || FIGURAS[0],
    [figuraBiblioId]
  );

  const escenarioBiblio = useMemo(
    () => generarEscenarioFigura(figuraBiblio),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [figuraBiblio, semillaBiblio]
  );

  const reveladaEnJuego = respuestaUsuario !== null;
  const figuraMostrada = modo === 'biblioteca' ? figuraBiblio : pregunta.figura;

  return (
    <div className="juego-layout">
      {/* 1. BARRA SUPERIOR DE PROGRESO (Nivel, XP, Racha, Aciertos) */}
      <div className="juego-stats-grid">
        <div className="panel juego-stat-card nivel-card">
          <div className="nivel-top-row">
            <div>
              <span className="kpi-label">Nivel {infoNivel.indice}</span>
              <h3 className="nivel-nombre">{infoNivel.nombre}</h3>
            </div>
            <div className="nivel-xp-right tabular">
              <span className="xp-badge">{xp} XP</span>
              <span className="xp-faltan text-sec">
                {infoNivel.esMaximo
                  ? 'Nivel máximo alcanzado'
                  : `Faltan ${infoNivel.faltan} XP para ${infoNivel.nombreSiguiente}`}
              </span>
            </div>
          </div>
          <div className="nivel-progress-track">
            <div
              className="nivel-progress-fill"
              style={{ width: `${infoNivel.progresoPct}%` }}
            />
          </div>
        </div>

        <div className="panel juego-stat-card">
          <span className="kpi-label">Racha actual</span>
          <span className="kpi-value tabular text-amber">
            🔥 {racha}
          </span>
          <span className="text-sec tabular" style={{ fontSize: '12px' }}>
            Máxima: <strong>{rachaMax}</strong>
          </span>
        </div>

        <div className="panel juego-stat-card">
          <span className="kpi-label">Aciertos</span>
          <span className="kpi-value tabular">
            {aciertos} / {intentos}
          </span>
          <span className="text-sec tabular" style={{ fontSize: '12px' }}>
            Efectividad: <strong className="text-green">{pctAciertos}%</strong>
          </span>
        </div>
      </div>

      {/* 2. CUERPO PRINCIPAL: JUEGO / BIBLIOTECA A LA IZQUIERDA + RANKING TOP 10 A LA DERECHA */}
      <div className="juego-main-grid">
        <div className="juego-left-col">
          {/* Pestañas de los 3 Modos */}
          <div className="panel juego-modes-bar">
            <div className="juego-mode-tabs" role="tablist">
              <button
                type="button"
                className={`juego-mode-tab ${modo === 'identifica' ? 'active' : ''}`}
                onClick={() => cambiarModo('identifica')}
              >
                1. Identifica la figura
              </button>
              <button
                type="button"
                className={`juego-mode-tab ${modo === 'direccion' ? 'active' : ''}`}
                onClick={() => cambiarModo('direccion')}
              >
                2. ¿Sube o baja?
              </button>
              <button
                type="button"
                className={`juego-mode-tab ${modo === 'biblioteca' ? 'active' : ''}`}
                onClick={() => cambiarModo('biblioteca')}
              >
                3. Biblioteca ({FIGURAS.length} figuras)
              </button>
            </div>
          </div>

          {modo !== 'biblioteca' ? (
            /* MODOS 1 y 2: JUEGO INTERACTIVO */
            <div className="panel juego-arena">
              <div className="arena-header">
                <div>
                  <span className="arena-badge">
                    {modo === 'identifica'
                      ? 'Modo: Identifica la figura'
                      : 'Modo: ¿Sube o baja?'}
                  </span>
                  <h2 className="arena-title">
                    {reveladaEnJuego
                      ? `${figuraMostrada.nombre} — ${
                          figuraMostrada.direccion === 'sube' ? '▲ Alcista' : '▼ Bajista'
                        }`
                      : modo === 'identifica'
                      ? '¿Qué figura o lectura chartista se está formando?'
                      : 'Según esta formación chartista, ¿el precio sube o baja?'}
                  </h2>
                </div>

                {reveladaEnJuego && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={siguientePregunta}
                  >
                    Siguiente →
                  </button>
                )}
              </div>

              {/* Barra de herramientas de dibujo */}
              <div className="chartismo-toolbar">
                <button
                  type="button"
                  className={`btn btn-sm ${herramientaDibujo === 'tendencia' ? 'btn-primary' : 'btn-ghost'}`}
                  disabled={reveladaEnJuego}
                  onClick={() =>
                    setHerramientaDibujo((prev) => (prev === 'tendencia' ? null : 'tendencia'))
                  }
                >
                  ╱ Línea de tendencia (2 clics)
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${herramientaDibujo === 'horizontal' ? 'btn-primary' : 'btn-ghost'}`}
                  disabled={reveladaEnJuego}
                  onClick={() =>
                    setHerramientaDibujo((prev) => (prev === 'horizontal' ? null : 'horizontal'))
                  }
                >
                  ― Línea horizontal (1 clic)
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={reveladaEnJuego || lineasUsuario.length === 0}
                  onClick={() => setLineasUsuario((prev) => prev.slice(0, -1))}
                >
                  ↶ Deshacer
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={reveladaEnJuego || lineasUsuario.length === 0}
                  onClick={() => setLineasUsuario([])}
                >
                  🗑 Borrar todo
                </button>
                {lineasUsuario.length > 0 && (
                  <span className="text-sec" style={{ fontSize: '12px', marginLeft: 'auto' }}>
                    {lineasUsuario.length} {lineasUsuario.length === 1 ? 'línea' : 'líneas'} trazadas
                  </span>
                )}
              </div>

              <ChartismoCanvas
                escenario={pregunta.escenario}
                revelado={reveladaEnJuego}
                altura={370}
                herramienta={herramientaDibujo}
                lineasUsuario={lineasUsuario}
                dibujoHabilitado={!reveladaEnJuego}
                onAgregarLinea={(linea) => setLineasUsuario((prev) => [...prev, linea])}
              />

              {/* Opciones de respuesta */}
              {modo === 'identifica' ? (
                <div className="opciones-grid cuatro">
                  {pregunta.opciones.map((op) => {
                    const esLaCorrecta = op.id === pregunta.figura.id;
                    const fueElegida = respuestaUsuario === op.id;
                    let claseEstado = '';
                    if (reveladaEnJuego) {
                      if (esLaCorrecta) claseEstado = 'correcta';
                      else if (fueElegida) claseEstado = 'incorrecta';
                    }

                    return (
                      <button
                        key={op.id}
                        type="button"
                        className={`btn-opcion ${claseEstado}`}
                        onClick={() => manejarRespuesta(op.id)}
                        disabled={reveladaEnJuego}
                      >
                        <span className="opcion-nombre">{op.nombre}</span>
                        <span className="opcion-tipo text-sec">{op.tipo}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="opciones-grid dos">
                  {[
                    { val: 'sube', label: '▲ Sube', sub: 'Resolución alcista' },
                    { val: 'baja', label: '▼ Baja', sub: 'Resolución bajista' },
                  ].map((op) => {
                    const esLaCorrecta = op.val === pregunta.figura.direccion;
                    const fueElegida = respuestaUsuario === op.val;
                    let claseEstado = '';
                    if (reveladaEnJuego) {
                      if (esLaCorrecta) claseEstado = 'correcta';
                      else if (fueElegida) claseEstado = 'incorrecta';
                    }

                    return (
                      <button
                        key={op.val}
                        type="button"
                        className={`btn-opcion direccion-btn ${op.val} ${claseEstado}`}
                        onClick={() => manejarRespuesta(op.val)}
                        disabled={reveladaEnJuego}
                      >
                        <span className="opcion-nombre">{op.label}</span>
                        <span className="opcion-tipo text-sec">{op.sub}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Ficha explicativa al responder */}
              {reveladaEnJuego && (
                <div className="ficha-chartismo">
                  <div className="ficha-resultado-banner">
                    {(modo === 'identifica' &&
                      respuestaUsuario === figuraMostrada.id) ||
                    (modo === 'direccion' &&
                      respuestaUsuario === figuraMostrada.direccion) ? (
                      <span className="res-tag ok">
                        ✓ ¡Correcto! +{ultimoXpGanado} XP (10 base
                        {ultimoXpGanado - (evaluacionDibujo?.xpDibujo || 0) > 10
                          ? ` + ${ultimoXpGanado - (evaluacionDibujo?.xpDibujo || 0) - 10} bono racha`
                          : ''}
                        {(evaluacionDibujo?.xpDibujo || 0) > 0
                          ? ` + ${evaluacionDibujo.xpDibujo} dibujo`
                          : ''}
                        )
                      </span>
                    ) : (
                      <span className="res-tag fail">
                        ✗ Respuesta incorrecta · La racha vuelve a 0
                        {(evaluacionDibujo?.xpDibujo || 0) > 0
                          ? ` (+${evaluacionDibujo.xpDibujo} XP por dibujo)`
                          : ''}
                      </span>
                    )}

                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={siguientePregunta}
                    >
                      Siguiente →
                    </button>
                  </div>

                  {evaluacionDibujo?.resultados?.length > 0 && (
                    <div className="dibujo-eval-box">
                      <div className="dibujo-eval-title">
                        Evaluación de tu dibujo (líneas blancas vs líneas clave):
                      </div>
                      <ul className="dibujo-eval-list">
                        {evaluacionDibujo.resultados.map((r, i) => (
                          <li key={`${r.rol}_${i}`} className={r.ok ? 'ok' : 'revisa'}>
                            <strong>{r.nombre}:</strong> {r.detalle}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="ficha-header-tags">
                    <span className="ficha-chip nombre">{figuraMostrada.nombre}</span>
                    <span className="ficha-chip tipo">{figuraMostrada.tipo}</span>
                    <span
                      className={`ficha-chip dir ${
                        figuraMostrada.direccion === 'sube' ? 'sube' : 'baja'
                      }`}
                    >
                      {figuraMostrada.direccion === 'sube' ? '▲ Sube' : '▼ Baja'}
                    </span>
                    <span className="ficha-chip etiqueta">
                      Señal en vela #{figuraMostrada.ruptura}: {figuraMostrada.etiqueta}
                    </span>
                  </div>

                  <div className="ficha-grid">
                    <div className="ficha-bloque">
                      <h4>¿Qué es?</h4>
                      <p>{figuraMostrada.que_es}</p>
                    </div>
                    <div className="ficha-bloque">
                      <h4>Señal de confirmación</h4>
                      <p>{figuraMostrada.senal}</p>
                    </div>
                    <div className="ficha-bloque">
                      <h4>¿Cómo se opera?</h4>
                      <p>{figuraMostrada.como_se_opera}</p>
                    </div>
                  </div>

                  <div className="ficha-nota-obligatoria">
                    Las figuras no se cumplen siempre: por eso se espera la ruptura y se usa stop.
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* MODO 3: BIBLIOTECA (38 figuras agrupadas por tipo, ejemplo ya resuelto, sin XP) */
            <div className="biblioteca-container">
              <div className="panel juego-arena">
                <div className="arena-header">
                  <div>
                    <span className="arena-badge">
                      Biblioteca interactiva (sin XP) · {figuraBiblio.tipo}
                    </span>
                    <h2 className="arena-title">
                      {figuraBiblio.nombre}{' '}
                      <span
                        className={
                          figuraBiblio.direccion === 'sube' ? 'text-green' : 'text-red'
                        }
                      >
                        ({figuraBiblio.direccion === 'sube' ? '▲ Sube' : '▼ Baja'})
                      </span>
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setSemillaBiblio((s) => s + 1)}
                  >
                    ↻ Otra simulación
                  </button>
                </div>

                <ChartismoCanvas
                  escenario={escenarioBiblio}
                  revelado={true}
                  altura={360}
                />

                <div className="ficha-chartismo" style={{ marginTop: '12px' }}>
                  <div className="ficha-header-tags">
                    <span className="ficha-chip nombre">{figuraBiblio.nombre}</span>
                    <span className="ficha-chip tipo">{figuraBiblio.tipo}</span>
                    <span
                      className={`ficha-chip dir ${
                        figuraBiblio.direccion === 'sube' ? 'sube' : 'baja'
                      }`}
                    >
                      {figuraBiblio.direccion === 'sube' ? '▲ Sube' : '▼ Baja'}
                    </span>
                    <span className="ficha-chip etiqueta">
                      Señal: {figuraBiblio.etiqueta} (vela #{figuraBiblio.ruptura})
                    </span>
                  </div>

                  <div className="ficha-grid">
                    <div className="ficha-bloque">
                      <h4>¿Qué es?</h4>
                      <p>{figuraBiblio.que_es}</p>
                    </div>
                    <div className="ficha-bloque">
                      <h4>Señal de confirmación</h4>
                      <p>{figuraBiblio.senal}</p>
                    </div>
                    <div className="ficha-bloque">
                      <h4>¿Cómo se opera?</h4>
                      <p>{figuraBiblio.como_se_opera}</p>
                    </div>
                  </div>

                  <div className="ficha-nota-obligatoria">
                    Las figuras no se cumplen siempre: por eso se espera la ruptura y se usa stop.
                  </div>
                </div>
              </div>

              {/* Catálogo de las 38 tarjetas agrupadas por `tipo` */}
              <div className="panel biblioteca-grupos">
                <h3>Catálogo completo ({FIGURAS.length} figuras y lecturas)</h3>
                <p className="text-sec" style={{ fontSize: '12.5px', marginBottom: '14px' }}>
                  Selecciona cualquier tarjeta para inspeccionar su formación, ruptura y explicación.
                </p>

                {gruposBiblioteca.map(([tipoGrupo, listaFiguras]) => (
                  <div key={tipoGrupo} className="biblio-grupo">
                    <h4 className="biblio-grupo-titulo">
                      {tipoGrupo} <span className="text-sec">({listaFiguras.length})</span>
                    </h4>
                    <div className="biblio-cards-grid">
                      {listaFiguras.map((item) => {
                        const activa = item.id === figuraBiblio.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`biblio-card ${activa ? 'active' : ''}`}
                            onClick={() => setFiguraBiblioId(item.id)}
                          >
                            <div className="biblio-card-top">
                              <span className="biblio-num">#{item.numero}</span>
                              <span
                                className={`biblio-dir ${
                                  item.direccion === 'sube' ? 'text-green' : 'text-red'
                                }`}
                              >
                                {item.direccion === 'sube' ? '▲ Sube' : '▼ Baja'}
                              </span>
                            </div>
                            <div className="biblio-card-name">{item.nombre}</div>
                            <div className="biblio-card-tag text-sec">{item.etiqueta}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* COLUMNA DERECHA: RANKING TOP 10 POR XP */}
        <aside className="panel juego-ranking-sidebar">
          <div className="ranking-header">
            <h3>🏆 Ranking Top 10 (XP)</h3>
            <p className="text-sec" style={{ fontSize: '12px' }}>
              Clasificación en vivo de estudiantes
            </p>
          </div>

          <div className="table-responsive">
            <table className="fin-table ranking-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Estudiante</th>
                  <th className="num">XP</th>
                  <th className="num">Rend.</th>
                </tr>
              </thead>
              <tbody>
                {rankingTop.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      Aún no hay registros en el ranking.
                    </td>
                  </tr>
                ) : (
                  rankingTop.map((r, idx) => {
                    const esYo = r.uid === uid;
                    const rend = Number(r.rend || 0);
                    return (
                      <tr key={r.uid} className={esYo ? 'ranking-me-row' : ''}>
                        <td className="tabular">
                          <strong>{idx + 1}</strong>
                        </td>
                        <td>
                          <span className="ranking-nombre" title={r.nombre}>
                            {r.nombre || 'Estudiante'}
                          </span>
                          {esYo && <span className="ranking-yo-chip">Tú</span>}
                        </td>
                        <td className="num tabular">
                          <strong>{Number(r.xp || 0)}</strong>
                        </td>
                        <td
                          className={`num tabular ${
                            rend > 0.001
                              ? 'text-green'
                              : rend < -0.001
                              ? 'text-red'
                              : 'text-sec'
                          }`}
                        >
                          {rend >= 0 ? '+' : ''}
                          {rend.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="niveles-referencia">
            <h4>Escala de niveles</h4>
            <ul>
              {NIVELES.map((niv, i) => {
                const alcanzado = xp >= niv.xp;
                return (
                  <li key={niv.nombre} className={alcanzado ? 'alcanzado' : ''}>
                    <span>
                      {i + 1}. {niv.nombre}
                    </span>
                    <span className="tabular">{niv.xp} XP</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
