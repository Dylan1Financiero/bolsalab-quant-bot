import React, { useState, useMemo, useRef, useEffect } from 'react';
import { MAPA_ACTIVOS } from '../data/catalogo';
import { consultarGemini, SALDO_INICIAL } from '../services/firebase';

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MODOS_CONTEXTO = [
  {
    id: 'portafolio',
    label: '💼 Con mi portafolio',
    desc: 'Incluye tu efectivo, posiciones abiertas, pesos % y P&L actual',
  },
  {
    id: 'bot',
    label: '🤖 Con el estado del bot',
    desc: 'Envía contexto: "BOT" para analizar el activo, estrategia y riesgo del bot',
  },
  {
    id: 'libre',
    label: '💬 Pregunta libre',
    desc: 'Consulta abierta sobre finanzas, chartismo, ML o gestión de riesgo',
  },
];

const PREGUNTAS_SUGERIDAS = [
  '¿Cómo está la diversificación y el riesgo actual de mi portafolio y qué ajustes sugieres?',
  'Evalúa la señal actual del bot, los niveles de soporte/resistencia y si conviene operar ahora.',
  '¿Cómo funcionan las métricas VaR, CVaR y CAViaR al 99% y cómo debo usar un Stop Loss?',
];

function fmtHora(ts) {
  try {
    return new Date(ts).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (_) {
    return '';
  }
}

export default function AnalistaIAView({
  uid,
  perfil,
  precios = {},
  resumenFinanciero = null,
  botEstado = null,
  onToast,
}) {
  const [modoContexto, setModoContexto] = useState('portafolio'); // 'portafolio' | 'bot' | 'libre'
  const [preguntaInput, setPreguntaInput] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [segundosEspera, setSegundosEspera] = useState(0);
  const [mensajes, setMensajes] = useState([
    {
      id: 'welcome',
      rol: 'ia',
      modo: 'portafolio',
      ts: Date.now(),
      texto:
        'Hola, soy tu Analista Financiero IA impulsado por Gemini.\n\nElige a la izquierda el contexto que deseas adjuntar ("Con mi portafolio", "Con el estado del bot" o "Pregunta libre"), selecciona una de las 3 preguntas sugeridas o escribe tu propia consulta.',
    },
  ]);

  const chatEndRef = useRef(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [mensajes, enviando]);

  useEffect(() => {
    if (!enviando) {
      setSegundosEspera(0);
      return undefined;
    }
    const timer = setInterval(() => {
      setSegundosEspera((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [enviando]);

  const efectivo = Number(resumenFinanciero?.efectivo ?? perfil?.saldo ?? SALDO_INICIAL);
  const valorPosiciones = Number(resumenFinanciero?.valorPosiciones ?? 0);
  const patrimonio = Number(resumenFinanciero?.patrimonio ?? efectivo + valorPosiciones);
  const rendimientoPct = Number(
    resumenFinanciero?.rendimientoPct ??
      ((patrimonio - SALDO_INICIAL) / SALDO_INICIAL) * 100
  );

  // Construcción del texto de contexto del portafolio (Sección 5.6)
  const textoContextoPortafolio = useMemo(() => {
    const mapaPos = perfil?.posiciones || {};
    const filas = [];

    for (const [sym, pos] of Object.entries(mapaPos)) {
      const cant = Number(pos?.cant || 0);
      if (cant <= 1e-8) continue;
      const costo = Number(pos?.costo || 0);
      const cot = precios?.[sym];
      const precioActual =
        cot?.disponible && Number(cot.p) > 0 ? Number(cot.p) : costo;
      const valor = cant * precioActual;
      const costoTotal = cant * costo;
      const pnlUSD = valor - costoTotal;
      const pnlPct = costoTotal > 0 ? (pnlUSD / costoTotal) * 100 : 0;
      const pesoPct = patrimonio > 0 ? (valor / patrimonio) * 100 : 0;
      const nombre = MAPA_ACTIVOS[sym]?.nombre || sym;

      filas.push(
        `- ${sym} (${nombre}): cant=${cant.toFixed(5)}, costoProm=${fmtUSD.format(
          costo
        )}, precioActual=${fmtUSD.format(precioActual)}, valor=${fmtUSD.format(
          valor
        )} (peso=${pesoPct.toFixed(1)}%), P&L=${
          pnlUSD >= 0 ? '+' : ''
        }${fmtUSD.format(pnlUSD)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`
      );
    }

    const detallePos =
      filas.length === 0
        ? 'Sin posiciones abiertas (100% en efectivo disponible).'
        : filas.join('\n');

    return [
      `Efectivo disponible: ${fmtUSD.format(efectivo)}`,
      `Valor en posiciones: ${fmtUSD.format(valorPosiciones)}`,
      `Patrimonio total: ${fmtUSD.format(patrimonio)} (base inicial $${SALDO_INICIAL.toLocaleString('en-US')} USD)`,
      `Rendimiento total: ${rendimientoPct >= 0 ? '+' : ''}${rendimientoPct.toFixed(2)}%`,
      `Posiciones actuales (con pesos y P&L):\n${detallePos}`,
    ].join('\n');
  }, [perfil?.posiciones, precios, efectivo, valorPosiciones, patrimonio, rendimientoPct]);

  const enviarConsultaIA = async (preguntaTexto, modoForzado = null) => {
    if (!uid || enviando) return;
    const modoUsar = modoForzado || modoContexto;
    const preguntaLimpia = (preguntaTexto ?? preguntaInput).trim();

    if (!preguntaLimpia && modoUsar !== 'bot') {
      if (onToast) onToast('Escribe una pregunta o elige una sugerencia.', 'warn');
      return;
    }

    const contextoEnviar =
      modoUsar === 'portafolio'
        ? textoContextoPortafolio
        : modoUsar === 'bot'
        ? 'BOT'
        : '';

    const etiquetaModo =
      modoUsar === 'portafolio'
        ? 'Con mi portafolio'
        : modoUsar === 'bot'
        ? 'Con el estado del bot ("BOT")'
        : 'Pregunta libre';

    const msgUsuario = {
      id: `u_${Date.now()}`,
      rol: 'usuario',
      modo: etiquetaModo,
      ts: Date.now(),
      texto:
        preguntaLimpia ||
        'Analiza el estado actual del bot, la estructura chartista y el semáforo de riesgo.',
    };

    setMensajes((prev) => [...prev, msgUsuario]);
    setPreguntaInput('');
    setEnviando(true);

    try {
      const res = await consultarGemini({
        uid,
        pregunta: preguntaLimpia,
        contexto: contextoEnviar,
        estadoBot: botEstado,
      });

      setMensajes((prev) => [
        ...prev,
        {
          id: `ia_${Date.now()}`,
          rol: 'ia',
          modo: etiquetaModo,
          consultaId: res.consultaId || null,
          ts: Date.now(),
          error: !res.ok,
          texto:
            res.respuesta ||
            'El bot no respondió. Revisa que el bot esté encendido y en línea.',
        },
      ]);
    } catch (_) {
      setMensajes((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          rol: 'ia',
          modo: etiquetaModo,
          ts: Date.now(),
          error: true,
          texto: 'El bot no respondió. Revisa que el bot esté encendido y en línea.',
        },
      ]);
    } finally {
      setEnviando(false);
    }
  };

  const manejarSubmit = (e) => {
    e.preventDefault();
    enviarConsultaIA(preguntaInput);
  };

  const manejarSugerencia = (idx) => {
    const q = PREGUNTAS_SUGERIDAS[idx];
    // Ajustar el contexto automáticamente si elige la pregunta 1 o 2
    if (idx === 0) {
      setModoContexto('portafolio');
      enviarConsultaIA(q, 'portafolio');
    } else if (idx === 1) {
      setModoContexto('bot');
      enviarConsultaIA(q, 'bot');
    } else {
      setModoContexto('libre');
      enviarConsultaIA(q, 'libre');
    }
  };

  return (
    <div className="ia-layout">
      {/* Columna izquierda: Selector de contexto + Resumen del contexto activo + 3 preguntas sugeridas */}
      <aside className="panel ia-sidebar">
        <div>
          <span className="kpi-label">1. SELECTOR DE CONTEXTO</span>
          <h3 style={{ marginTop: '4px', fontSize: '15px' }}>
            ¿Qué datos deseas enviar a Gemini?
          </h3>
          <p className="text-sec" style={{ fontSize: '12px', marginTop: '2px' }}>
            Elige las fuentes de tu cuenta y del bot que quieres incluir como contexto para tu consulta.
          </p>
        </div>

        <div className="ia-context-selector" role="radiogroup" aria-label="Selector de contexto">
          {MODOS_CONTEXTO.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`ia-context-btn ${modoContexto === m.id ? 'active' : ''}`}
              onClick={() => setModoContexto(m.id)}
              disabled={enviando}
            >
              <div className="ia-context-btn-title">{m.label}</div>
              <div className="ia-context-btn-desc">{m.desc}</div>
            </button>
          ))}
        </div>

        {/* Vista previa del contexto que se enviará en el documento de `consultas` */}
        <div className="ia-context-preview-box">
          <div className="ia-preview-header">
            <span>Vista previa de <code>contexto</code></span>
            <span className="dash-mini-tag">
              {modoContexto === 'portafolio'
                ? 'Portafolio en vivo'
                : modoContexto === 'bot'
                ? 'contexto: "BOT"'
                : 'Vacío ("")'}
            </span>
          </div>
          <pre className="ia-context-pre tabular">
            {modoContexto === 'portafolio'
              ? textoContextoPortafolio
              : modoContexto === 'bot'
              ? `contexto: "BOT"\nActivo del bot: ${botEstado?.asset || 'BTC_USDT'} (${
                  botEstado?.timeframe || '15m'
                })\nEstrategia: ${botEstado?.strategy_label || 'Chartismo'}\nSeñal: ${
                  botEstado?.signal_now || 'HOLD'
                }`
              : 'Sin contexto adjunto (consulta financiera abierta).'}
          </pre>
        </div>

        {/* 3 Preguntas sugeridas (Sección 5.6) */}
        <div className="ia-suggestions-box">
          <span className="kpi-label">2. PREGUNTAS SUGERIDAS (CLIC PARA ENVIAR)</span>
          <div className="ia-suggestions-list">
            {PREGUNTAS_SUGERIDAS.map((q, idx) => (
              <button
                key={q}
                type="button"
                className="ia-suggestion-pill"
                disabled={enviando}
                onClick={() => manejarSugerencia(idx)}
              >
                <span className="ia-sug-num">#{idx + 1}</span>
                <span>{q}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Columna derecha: Ventana de Chat con el Analista IA */}
      <section className="panel ia-chat-panel" aria-label="Chat con Analista IA">
        <div className="ia-chat-header">
          <div>
            <h2>✨ Analista Financiero IA (Gemini)</h2>
            <p className="text-sec" style={{ fontSize: '12px' }}>
              Asistente cuantitativo en tiempo real · Modo activo:{' '}
              <strong className="text-accent">
                {MODOS_CONTEXTO.find((m) => m.id === modoContexto)?.label}
              </strong>
            </p>
          </div>

          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={() =>
              setMensajes([
                {
                  id: 'welcome',
                  rol: 'ia',
                  modo: modoContexto,
                  ts: Date.now(),
                  texto:
                    'Conversación reiniciada. Selecciona un contexto o una pregunta sugerida para consultar a Gemini a través del bot.',
                },
              ])
            }
            disabled={enviando}
          >
            Limpiar chat
          </button>
        </div>

        {/* Lista de mensajes */}
        <div className="ia-messages-container">
          {mensajes.map((m) => (
            <div
              key={m.id}
              className={`ia-msg-row ${m.rol === 'usuario' ? 'user' : 'assistant'}`}
            >
              <div
                className={`ia-msg-bubble ${
                  m.rol === 'usuario' ? 'user' : m.error ? 'error' : 'assistant'
                }`}
              >
                <div className="ia-msg-meta">
                  <strong>
                    {m.rol === 'usuario'
                      ? perfil?.nombre || 'Tú'
                      : '🧠 Analista IA (Gemini)'}
                  </strong>
                  <div className="ia-msg-tags">
                    {m.modo && <span className="ia-mode-tag">{m.modo}</span>}
                    {m.consultaId && (
                      <span
                        className="ia-doc-tag tabular"
                        title="Identificador de consulta procesada por Gemini"
                      >
                        #{m.consultaId.slice(0, 6)}
                      </span>
                    )}
                    <span className="tabular">{fmtHora(m.ts)}</span>
                  </div>
                </div>
                <div className="ia-msg-text">{m.texto}</div>
              </div>
            </div>
          ))}

          {enviando && (
            <div className="ia-msg-row assistant">
              <div className="ia-msg-bubble assistant loading">
                <div className="ia-msg-meta">
                  <strong>🧠 Analista IA (Gemini)</strong>
                  <span className="tabular">{segundosEspera}s / máx 90s</span>
                </div>
                <div className="ia-msg-text">
                  <span>
                    Esperando respuesta del bot en Firestore (<code>estado == &quot;lista&quot;</code>)
                  </span>
                  <span className="ia-thinking-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Formulario para enviar pregunta */}
        <form className="ia-input-form" onSubmit={manejarSubmit}>
          <input
            type="text"
            className="ia-text-input"
            placeholder={
              modoContexto === 'portafolio'
                ? 'Pregunta sobre tu portafolio (ej. ¿Cómo reduzco mi riesgo?)...'
                : modoContexto === 'bot'
                ? 'Pregunta sobre el estado del bot (o deja vacío para reporte completo)...'
                : 'Escribe cualquier pregunta de finanzas, chartismo o trading...'
            }
            value={preguntaInput}
            onChange={(e) => setPreguntaInput(e.target.value)}
            disabled={enviando}
          />
          <button
            type="submit"
            className="btn btn-primary ia-send-btn"
            disabled={
              enviando || (!preguntaInput.trim() && modoContexto !== 'bot')
            }
          >
            {enviando ? 'Consultando...' : 'Enviar a Gemini →'}
          </button>
        </form>
      </section>
    </div>
  );
}
