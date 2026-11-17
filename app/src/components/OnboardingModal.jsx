import React, { useState } from 'react';
import { PRO_GRATIS } from '../config/planConfig';
import { guardarOnboardingUsuario } from '../services/firebase';

const OPCIONES_OBJETIVO = [
  {
    id: 'graficos',
    icono: '📈',
    titulo: 'Quiero aprender a leer gráficos',
    desc: 'Aprende las 38 figuras de chartismo jugando, gana XP y sube en el ranking.',
    seccion: 'juego',
    seccionNombre: 'Juega y aprende',
  },
  {
    id: 'trading',
    icono: '⚡',
    titulo: 'Quiero hacer trading de corto plazo (day trading)',
    desc: 'Opera por tu cuenta en el simulador de casa de bolsa con precios en vivo y gráficos.',
    seccion: 'mercado',
    seccionNombre: 'Mercado',
  },
  {
    id: 'largo_plazo',
    icono: '💼',
    titulo: 'Quiero invertir a largo plazo y armar mi portafolio',
    desc: 'Construye una cartera con Machine Learning: régimen de volatilidad, Markowitz y Paridad de Riesgo.',
    seccion: 'portafolio',
    seccionNombre: 'Portafolio',
  },
  {
    id: 'explorar',
    icono: '🧭',
    titulo: 'Quiero explorar todo',
    desc: 'Recorre libremente el simulador de mercado, el juego chartista, el bot y el portafolio ML.',
    seccion: 'mercado',
    seccionNombre: 'Mercado',
  },
];

const OPCIONES_EXPERIENCIA = [
  {
    id: 'ninguna',
    icono: '🌱',
    titulo: 'Ninguna',
    desc: 'Es mi primer acercamiento a inversiones o simuladores financieros.',
  },
  {
    id: 'algo',
    icono: '📘',
    titulo: 'Algo',
    desc: 'Conozco conceptos básicos como acciones, ETFs o criptomonedas.',
  },
  {
    id: 'bastante',
    icono: '🎯',
    titulo: 'Bastante',
    desc: 'Ya he analizado gráficos, métricas de riesgo o portafolios antes.',
  },
];

const PREGUNTAS_RIESGO = [
  {
    id: 'caida',
    pregunta: 'Si tu inversión cae 20% en un mes, ¿qué haces?',
    opciones: [
      { pts: 1, texto: 'Vendo todo para evitar más pérdidas' },
      { pts: 2, texto: 'Espero con calma a que se recupere' },
      { pts: 3, texto: 'Compro más aprovechando el descuento' },
    ],
  },
  {
    id: 'plazo',
    pregunta: '¿Para cuándo necesitas el dinero?',
    opciones: [
      { pts: 1, texto: 'Menos de 1 año' },
      { pts: 2, texto: 'Entre 1 y 5 años' },
      { pts: 3, texto: 'Más de 5 años' },
    ],
  },
  {
    id: 'preferencia',
    pregunta: '¿Qué prefieres al invertir?',
    opciones: [
      { pts: 1, texto: 'No perder capital, aunque gane poco' },
      { pts: 2, texto: 'Equilibrio entre rendimiento y estabilidad' },
      { pts: 3, texto: 'Máximo crecimiento aunque haya caídas fuertes' },
    ],
  },
];

export function calcularPerfilRiesgo(puntaje) {
  if (puntaje <= 4) return 'conservador';
  if (puntaje <= 7) return 'moderado';
  return 'agresivo';
}

export default function OnboardingModal({
  uid,
  perfil,
  onCompletar,
  onCerrarOpcional,
  onToast,
}) {
  const [paso, setPaso] = useState(1);
  const [objetivo, setObjetivo] = useState(perfil?.objetivo || '');
  const [experiencia, setExperiencia] = useState(perfil?.experiencia || '');
  const [respuestasRiesgo, setRespuestasRiesgo] = useState({
    caida: null,
    plazo: null,
    preferencia: null,
  });
  const [guardando, setGuardando] = useState(false);

  const requiereRiesgo = objetivo === 'trading' || objetivo === 'largo_plazo';
  const totalPasos = requiereRiesgo ? 4 : 3;
  const pasoVisual = !requiereRiesgo && paso === 4 ? 3 : paso;
  const progresoPct = Math.round((pasoVisual / totalPasos) * 100);

  const puntajeRiesgo = requiereRiesgo
    ? Number(respuestasRiesgo.caida || 0) +
      Number(respuestasRiesgo.plazo || 0) +
      Number(respuestasRiesgo.preferencia || 0)
    : 0;

  const perfilRiesgo = requiereRiesgo
    ? calcularPerfilRiesgo(puntajeRiesgo)
    : perfil?.perfil_riesgo || 'moderado';

  const objMeta =
    OPCIONES_OBJETIVO.find((o) => o.id === objetivo) || OPCIONES_OBJETIVO[3];

  const todasRiesgoRespondidas =
    respuestasRiesgo.caida !== null &&
    respuestasRiesgo.plazo !== null &&
    respuestasRiesgo.preferencia !== null;

  const finalizarYIr = async (seccionDestino) => {
    if (!uid || guardando) return;
    setGuardando(true);
    try {
      await guardarOnboardingUsuario(uid, {
        objetivo: objetivo || 'explorar',
        experiencia: experiencia || 'ninguna',
        perfil_riesgo: perfilRiesgo,
        puntaje_riesgo: puntajeRiesgo,
      });
      if (onToast) {
        onToast('Tu perfil y plan recomendado se guardaron correctamente.', 'success');
      }
      if (onCompletar) {
        onCompletar(seccionDestino);
      }
    } catch (err) {
      console.error('Error guardando onboarding:', err);
      if (onToast) {
        onToast('No se pudo guardar tu perfil. Intenta de nuevo.', 'error');
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-label="Asistente de bienvenida">
      <video
        className="bg-video-layer"
        src="/video_interfaz.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        ref={(el) => {
          if (el) {
            el.muted = true;
            el.defaultMuted = true;
            el.volume = 0;
          }
        }}
      />
      <div className="bg-video-scrim" aria-hidden="true" />
      <div className="panel onb-modal">
        <div className="onb-top">
          <div>
            <span className="onb-badge">BIENVENIDO A BOLSALAB</span>
            <p className="text-sec" style={{ fontSize: '12px', marginTop: '4px' }}>
              Paso {pasoVisual} de {totalPasos}
            </p>
          </div>
          {onCerrarOpcional && (
            <button
              type="button"
              className="btn btn-outline btn-xs"
              onClick={onCerrarOpcional}
            >
              Cerrar
            </button>
          )}
        </div>

        <div className="onb-progress-track">
          <div className="onb-progress-fill" style={{ width: `${progresoPct}%` }} />
        </div>

        {/* PASO 1: OBJETIVO */}
        {paso === 1 && (
          <div className="onb-step">
            <h2>¿Qué te trae a BolsaLab?</h2>
            <p className="text-sec">
              Elige tu camino principal para adaptar la experiencia desde el primer momento:
            </p>

            <div className="onb-options-grid">
              {OPCIONES_OBJETIVO.map((op) => (
                <button
                  key={op.id}
                  type="button"
                  data-onb-objetivo={op.id}
                  className={`onb-option-card ${objetivo === op.id ? 'selected' : ''}`}
                  onClick={() => {
                    setObjetivo(op.id);
                    setPaso(2);
                  }}
                >
                  <span className="onb-option-icon">{op.icono}</span>
                  <div>
                    <strong>{op.titulo}</strong>
                    <p>{op.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PASO 2: EXPERIENCIA */}
        {paso === 2 && (
          <div className="onb-step">
            <h2>¿Cuánta experiencia tienes invirtiendo?</h2>
            <p className="text-sec">
              Esto nos ayuda a calibrar las recomendaciones iniciales para tu cuenta de $10,000 USD virtuales.
            </p>

            <div className="onb-options-grid">
              {OPCIONES_EXPERIENCIA.map((op) => (
                <button
                  key={op.id}
                  type="button"
                  data-onb-exp={op.id}
                  className={`onb-option-card ${experiencia === op.id ? 'selected' : ''}`}
                  onClick={() => {
                    setExperiencia(op.id);
                    setPaso(requiereRiesgo ? 3 : 4);
                  }}
                >
                  <span className="onb-option-icon">{op.icono}</span>
                  <div>
                    <strong>{op.titulo}</strong>
                    <p>{op.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            <div className="onb-footer-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setPaso(1)}
              >
                ← Atrás
              </button>
            </div>
          </div>
        )}

        {/* PASO 3: PERFIL DE RIESGO (SOLO TRADING O LARGO PLAZO) */}
        {paso === 3 && requiereRiesgo && (
          <div className="onb-step">
            <h2>Tu perfil de riesgo</h2>
            <p className="text-sec">
              Responde estas 3 preguntas rápidas (1 a 3 puntos cada una) para definir tu perfil:
            </p>

            <div className="onb-risk-questions">
              {PREGUNTAS_RIESGO.map((preg, idx) => (
                <div key={preg.id} className="onb-risk-q-box">
                  <h4>
                    {idx + 1}. {preg.pregunta}
                  </h4>
                  <div className="onb-risk-choices">
                    {preg.opciones.map((op) => {
                      const activa = respuestasRiesgo[preg.id] === op.pts;
                      return (
                        <button
                          key={op.pts}
                          type="button"
                          data-risk-q={preg.id}
                          data-risk-pts={op.pts}
                          className={`onb-risk-pill ${activa ? 'selected' : ''}`}
                          onClick={() =>
                            setRespuestasRiesgo((prev) => ({
                              ...prev,
                              [preg.id]: op.pts,
                            }))
                          }
                        >
                          <span>{op.texto}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="onb-footer-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setPaso(2)}
              >
                ← Atrás
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!todasRiesgoRespondidas}
                onClick={() => setPaso(4)}
              >
                Ver mi plan recomendado →
              </button>
            </div>
          </div>
        )}

        {/* PASO 4: TU PLAN RECOMENDADO */}
        {paso === 4 && (
          <div className="onb-step">
            <h2>Tu plan recomendado</h2>

            <div className="onb-plan-card">
              <div className="onb-plan-header">
                <div>
                  <span className="text-sec" style={{ fontSize: '12px' }}>
                    Camino recomendado
                  </span>
                  <h3>
                    {objMeta.icono} {objMeta.seccionNombre}
                  </h3>
                </div>
                {requiereRiesgo && (
                  <span className={`onb-risk-badge ${perfilRiesgo}`}>
                    Perfil: {perfilRiesgo.toUpperCase()} ({puntajeRiesgo} pts)
                  </span>
                )}
              </div>

              <p className="onb-plan-why">
                {objetivo === 'graficos' &&
                  'Elegiste aprender a leer gráficos. La mejor forma de empezar es reconocer patrones reales paso a paso sin arriesgar capital.'}
                {objetivo === 'trading' &&
                  `Elegiste trading de corto plazo con perfil ${perfilRiesgo}. Te recomendamos operar primero por tu cuenta en el simulador de Mercado con montos pequeños.`}
                {objetivo === 'largo_plazo' &&
                  `Elegiste inversión a largo plazo con perfil ${perfilRiesgo}. El motor de Machine Learning filtrará los activos según tu tolerancia al riesgo y optimizará tu cartera.`}
                {objetivo === 'explorar' &&
                  'Elegiste explorar todo BolsaLab. Te llevamos al simulador principal desde donde podrás recorrer las 5 herramientas.'}
              </p>

              <ul className="onb-recommendations-list">
                {objetivo === 'graficos' && (
                  <>
                    <li>📚 Empieza revisando la <strong>Biblioteca</strong> para conocer las 38 figuras chartistas.</li>
                    <li>🎯 Practica en el modo <strong>&quot;Identifica la figura&quot;</strong> con líneas y flechas de ruptura.</li>
                    <li>🏆 Tu primera meta: alcanzar <strong>50 XP</strong> para subir al nivel <strong>Aprendiz</strong>.</li>
                  </>
                )}

                {objetivo === 'trading' && (
                  <>
                    <li>💵 Opera en <strong>Mercado</strong> por tu cuenta con montos pequeños sobre tus $10,000 USD virtuales.</li>
                    <li>📐 Apóyate en el gráfico de TradingView y en los filtros de riesgo (VaR / CVaR / CAViaR).</li>
                    <li>
                      🤖 Opcional: también puedes revisar el <strong>Bot de trading</strong> cuantitativo para comparar señales.
                    </li>
                  </>
                )}

                {objetivo === 'largo_plazo' && (
                  <>
                    <li>
                      🛡️ Tu perfil <strong>{perfilRiesgo}</strong> quedará precargado en la pestaña{' '}
                      <strong>Portafolio</strong> junto con tu efectivo disponible.
                    </li>
                    <li>
                      🧠 El bot clasificará el régimen de volatilidad (Opción 1) y estimará rendimientos con ML (Opción 2).
                    </li>
                    <li>
                      📊 Compara Markowitz, Paridad de Riesgo y validación estadística antes de pulsar{' '}
                      <strong>&quot;Invertir esta cartera&quot;</strong>.
                    </li>
                  </>
                )}

                {objetivo === 'explorar' && (
                  <>
                    <li>📈 Prueba comprar y vender en tiempo real en <strong>Mercado</strong>.</li>
                    <li>💼 Calcula tu cartera óptima en <strong>Portafolio</strong> con Machine Learning.</li>
                    <li>🎮 Aprende chartismo en <strong>Juega y aprende</strong> y consulta al <strong>Analista IA</strong>.</li>
                  </>
                )}
              </ul>

              {objetivo === 'trading' && (
                <div className="onb-optional-bot-box">
                  <span>
                    {PRO_GRATIS
                      ? '¿Quieres ver cómo opera el Bot Quant en tiempo real?'
                      : 'Como opción adicional, puedes conocer el Bot Quant automático (Plan Pro).'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-xs"
                    disabled={guardando}
                    onClick={() => finalizarYIr('bot')}
                  >
                    {PRO_GRATIS ? '🤖 Ir al bot' : '⚡ Conocer el bot'}
                  </button>
                </div>
              )}
            </div>

            <div className="onb-footer-actions">
              <button
                type="button"
                className="btn btn-outline"
                disabled={guardando}
                onClick={() => setPaso(requiereRiesgo ? 3 : 2)}
              >
                ← Atrás
              </button>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={guardando}
                  onClick={() => finalizarYIr('mercado')}
                >
                  Ver todo primero
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={guardando}
                  onClick={() => finalizarYIr(objMeta.seccion)}
                >
                  {guardando ? 'Guardando...' : `Ir ahora a ${objMeta.seccionNombre} →`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
