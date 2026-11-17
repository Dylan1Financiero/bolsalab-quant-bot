import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BOT_ESTRATEGIA_DATA as D,
  JOURNEY_DATA,
  STRATS_DATA,
  GLOSARIO_ESTRATEGIA,
} from '../data/estrategiaBotMonteCarlo';

const f1 = (x) => Number(x).toFixed(1);
const f2 = (x) => Number(x).toFixed(2);

const DEMO_CAPS = [
  ['1', 'El precio se sale del canal y regresa: hay señal.'],
  ['2', 'La tendencia va hacia arriba (EMA 200): sí puede comprar.'],
  ['3', 'Fija salidas por ATR (5:1) y RF ajusta x15 si hay alta convicción.'],
  ['4', 'Compra con pérdida pequeña y ganancia grande.'],
  ['✓', 'Llegó a la ganancia: gana 5 veces lo que arriesgó.'],
];

const DEMO_PASOS = [
  ['Espera un exceso', 'El precio se sale de su canal normal (Bandas de Bollinger 20, 2σ) y vuelve a entrar. Esa vuelta es la señal.'],
  ['Revisa la tendencia', 'Solo compra si el precio está sobre la EMA 200 y solo vende si está debajo. Nunca va contra la corriente.'],
  ['Sin bloqueo de RF (solo x15 en XRP)', 'Quitamos el filtro del Random Forest para no frenar entradas (opera 22 veces/día en vez de 9). El modelo sigue activo para subir el apalancamiento a x15 en XRP cuando la probabilidad es alta.'],
  ['Salidas fijas por ATR (5 : 1)', 'El ATR pronostica mejor el rango que el RF (DM p < 0.001): Stop Loss a 0.4 ATR y Take Profit a 2.0 ATR (equilibrio en 16.7%).'],
];

const GLOSARIO_DEFENSA_TABS = [
  { id: 'indicadores', label: '1. Los 6 Indicadores del Bot' },
  { id: 'riesgo', label: '2. VaR, CVaR y CAViaR' },
  { id: 'ml', label: '3. Modelos ML y Diebold-Mariano' },
  { id: 'preguntas', label: '4. Preguntas del Profesor' },
];

const INDICADORES_BOT_GUIA = [
  {
    titulo: '1. Bandas de Bollinger (20, 2σ) + Filtro EMA 200 (Estrategia Activa)',
    formula: 'Media MA₂₀ = ΣC/20 · Banda Sup/Inf = MA₂₀ ± 2·σ₂₀ · EMA₂₀₀ = αCₜ + (1−α)EMAₜ₋₁',
    queEs:
      'Canal estadístico dinámico alrededor del precio (±2 desviaciones estándar, ~95% del movimiento normal). Cuando el precio rompe una banda y vuelve a cerrar dentro, indica sobre-extensión y posible reversión a la media.',
    reglaBot:
      'LONG si vela anterior cerró < Banda Inf., vela actual cierra >= Banda Inf. y Precio > EMA 200. SHORT inverso (solo bajo EMA 200). PF 2.25 en XRP (sin filtro RF).',
  },
  {
    titulo: '2. Fibonacci + Abanicos + Líneas de Velocidad + Gann',
    formula: 'Retrocesos = P_ext − Δ · r (r ∈ 23.6%, 38.2%, 50%, 61.8%, 78.6%) · Vel. 1/3 y 2/3 · Gann 1×1, 1×2, 1×4',
    queEs:
      'Mide cuánto corrige un impulso previo entre su mínimo y máximo estructurales (sin mechas anómalas). Incluye líneas inclinadas desde el origen del impulso: Velocidad (1/3 y 2/3), Abanico clásico (1-2-3 pivotes) y ángulos de Gann.',
    reglaBot:
      'Dispara señal en rebotes sobre 38.2% o 61.8%, o al romper la línea de velocidad 1/3 o la 3ª directriz del abanico. En backtest dio PF 0.98 (se reemplazó por Bollinger).',
  },
  {
    titulo: '3. Chartismo Estructural v3.2 (Patrones, Canales R² y Filtro Anti-Clímax)',
    formula: 'HCH / Doble Techo-Suelo / Bandera / Triángulos / Cuñas / Canal R² · Confirmación: Cuerpo ≥ 0.6 ATR + Vol ≥ 1.2×',
    queEs:
      'Primero limpia mechas falsas con mediana robusta (_structural_series). Detecta pivotes ZigZag confirmados por cuerpos de vela, evalúa vigencia viva (_pattern_alive) y verifica rupturas con EMA 200, volumen 1.2x y filtro anti-clímax RSI (>74 o <26).',
    reglaBot:
      'Objetivo técnico = altura del patrón proyectada desde el punto de ruptura. En 1m dio PF 0.99 porque hay muchas rupturas falsas en ruido intradía.',
  },
  {
    titulo: '4. RSI (14) — Índice de Fuerza Relativa (Wilder)',
    formula: 'RS = Prom. Ganancias(14) / Prom. Pérdidas(14) · RSI = 100 · Gan / (Gan + Pérd)',
    queEs:
      'Oscilador acotado entre 0 y 100 que mide la velocidad e intensidad de los cambios recientes del precio. Arriba de 70 indica sobrecompra; abajo de 30 indica sobreventa.',
    reglaBot:
      'LONG cuando RSI cruza hacia arriba 30 (recupera de sobreventa) y Precio > EMA 200; SHORT cuando cruza hacia abajo 70 y Precio <= EMA 200. PF 1.13.',
  },
  {
    titulo: '5. Cruce de Medias Exponenciales (EMA 50 / EMA 200)',
    formula: 'Golden Cross: EMA₅₀ cruza arriba de EMA₂₀₀ · Death Cross: EMA₅₀ cruza abajo de EMA₂₀₀',
    queEs:
      'La EMA da mayor peso a las velas recientes (α = 2/(N+1)). EMA 50 sigue la tendencia de mediano plazo y EMA 200 la tendencia estructural mayor.',
    reglaBot:
      'Estrategia seguidora de tendencia clásica con PF 1.44, pero genera muy pocas señales en 1 minuto; por eso usamos EMA 200 como filtro maestro de Bollinger.',
  },
  {
    titulo: '6. SuperTrend (10, 3.0) y ATR (14) para Take Profit / Stop Loss',
    formula: 'TR = max(H−L, |H−Cₜ₋₁|, |L−Cₜ₋₁|) · ATR₁₄ = media(TR, 14) · Bandas ST = (H+L)/2 ± 3·ATR₁₀',
    queEs:
      'ATR (Average True Range) mide la volatilidad real por vela en dólares. SuperTrend usa ATR como trailing stop dinámico que cambia entre alcista (verde) y bajista (rojo).',
    reglaBot:
      'SuperTrend como entrada dio PF 0.75 (latigazos en lateral), pero ATR(14) es el corazón de las salidas del bot: TP = 2.0 × ATR y SL = 0.4 × ATR (relación 5:1).',
  },
];

const RIESGO_BOT_GUIA = [
  {
    titulo: 'CAViaR 99% (Conditional Autoregressive VaR) — Criptomonedas (Límite 1.50%)',
    formula: 'qₜ = 0.04 + 0.86·qₜ₋₁ + 0.38·|rₜ₋₁|   (Engle y Manganelli, 2004)',
    detalle:
      'Es un modelo dinámico de cuantil condicional (SAV simétrico): recuerda el 86% del riesgo de la vela anterior (qₜ₋₁) y reacciona inmediatamente al 38% del choque reciente |rₜ₋₁|. Cuando hay un flash crash en cripto, CAViaR sube al instante y el semáforo rojo bloquea nuevas entradas antes de que una ventana móvil histórica reaccione.',
  },
  {
    titulo: 'CVaR 99% (Expected Shortfall) — Acciones EE.UU. (Límite 2.20%)',
    formula: 'CVaR₉₉% = −E[ r | r ≤ q₀.₀₁(r) ]  (promedio del peor 1% de caídas en 150 velas)',
    detalle:
      'Mientras el VaR solo marca la frontera del peor 1%, el CVaR promedia TODAS las caídas extremas más allá de ese percentil. Es una medida coherente de riesgo de cola: cuantifica cuánto se pierde en promedio cuando ocurre un evento extremo.',
  },
  {
    titulo: 'VaR 99% Histórico — ETFs y Cartera Markowitz (Lím. 1.50% bot / 95% diario cartera)',
    formula: 'VaR₉₉% = −Percentil₁%(retornos_150_velas) · En cartera: −Percentil₅%(R_cartera)',
    detalle:
      'Indica la pérdida máxima esperada por vela en el 99% de los casos normales (o 95% diario en Portafolio: "en 1 de cada 20 días malos podrías perder alrededor de $X").',
  },
  {
    titulo: 'Gestión Matemática de Salidas (x10 / x15, WR* y Profit Factor)',
    formula: 'WR* = SL / (TP + SL) = 0.4 / (2.0 + 0.4) = 16.7% · PF = ΣGanancias / |ΣPérdidas|',
    detalle:
      'Margen fijo $100 USDT × 10 = $1,000 nocional (liquidación en ±9%; SL máximo topado en 6.5%). En XRP 1m, si Random Forest da prob. ≥ 50% y Valor Esperado ≥ 0.15%, el apalancamiento sube dinámicamente a x15. Como TP = 5× SL, con acertar >16.7% ya hay esperanza matemática positiva.',
  },
];

const ML_BOT_GUIA = [
  {
    titulo: 'Random Forest vs. CatBoost vs. KNN (Distancia Euclidiana) vs. Red Neuronal (MLP)',
    formula: 'KNN Distancia Euclidiana: d(x, xᵢ) = √Σ(xⱼ − xᵢⱼ)²   (con StandardScaler y weights="distance")',
    detalle:
      'En el Bot (Opción 3): Random Forest (50–200 árboles) vs CatBoost con purga de h=6 velas para no fugar datos futuros. En Portafolio (Opciones 1 y 2): panel diario con 17 variables técnicas (retornos, vol_5/20/60, RSI, SMA50/200, Beta al SPY) comparando RF, KNN Euclidiano y MLP Neural Net.',
  },
  {
    titulo: 'Métricas de Regresión: MAE, MSE, RMSE, MAPE, SMAPE y Variance Score',
    formula: 'RMSE = √(Σeₜ²/n) · MAPE = 100·mean(|eₜ/yₜ|) · SMAPE = 100·mean(2|eₜ|/(|yₜ|+|ŷₜ|)) · VarScore = 1 − Var(y−ŷ)/Var(y)',
    detalle:
      'MAE mide el error promedio en la misma unidad ($ o %); MSE/RMSE penalizan más los errores atípicos; MAPE y SMAPE expresan el error en porcentaje relativo (SMAPE acotado para evitar explosiones cuando y ≈ 0); Variance Score (0 a 1) indica cuánta varianza real explica el modelo.',
  },
  {
    titulo: 'Matriz de Confusión y F1-Score Macro / Por Clase',
    formula: 'Precision = TP/(TP+FP) · Recall = TP/(TP+FN) · F1 = 2·P·R/(P+R) · Macro F1 = promedio de clases',
    detalle:
      'Filas = realidad histórica; Columnas = predicción de la IA. En el bot clasifica 3 clases (Baja/Sell, Lateral/Hold, Sube/Buy usando umbral ±τ de volatilidad). En Portafolio Paso 1 clasifica régimen de volatilidad (baja/media/alta relativa a cada activo) y en Paso 2 matriz 2×2 direccional (baja/sube).',
  },
  {
    titulo: 'Test Estadístico de Diebold-Mariano (con ajuste de Harvey et al., 1997)',
    formula: 'dₜ = e²_modelo,t − e²_benchmark,t   ·   DM = d̄ / √V̂(d̄)   (DM < 0 y p < 0.05 = modelo superior)',
    detalle:
      'Evalúa si la diferencia de error frente al modelo ingenuo (caminata aleatoria en el bot; régimen repetido o media histórica en portafolio) es estadísticamente real o puro azar. Si DM > 0 y p < 0.05, el modelo es significativamente PEOR que la referencia simple.',
  },
];

const PREGUNTAS_PROFESOR_GUIA = [
  [
    '¿Por qué quitaron el filtro del Random Forest para entrar en el bot en vivo?',
    'Porque en la prueba fuera de muestra (BTC 1h), aunque Random Forest supera a CatBoost (DM −3.11, p = 0.002), NO supera de forma significativa a la caminata aleatoria (DM +1.11, p = 0.27), y además reducía las entradas a ~9 al día (pasando hasta 15 h sin operar). Sin el filtro de bloqueo el bot opera 22 veces/día en XRP manteniendo un Profit Factor de 2.25 (+70 USDT en backtest y PF 6.38 en las primeras operaciones en vivo), y seguimos usando RF para elevar el apalancamiento a x15 en XRP cuando la probabilidad y el valor esperado son altos.',
  ],
  [
    '¿Por qué dicen que el ATR fija mejor TP y SL que el Random Forest?',
    'Porque evaluamos 961 señales de entrenamiento y 962 de prueba en las 4 criptos midiendo el recorrido a 12 velas: al compararlos con Diebold-Mariano, el múltiplo del ATR tuvo menor error (MAE 0.169% vs 0.196% a favor) con diferencia altamente significativa (DM +5.10, p < 0.001 a favor; DM +3.52, p < 0.001 en contra). Por eso TP = 2.0 ATR y SL = 0.4 ATR.',
  ],
  [
    '¿Cómo gana dinero el bot si su Win Rate es ~25% (falla 3 de cada 4)?',
    'Por la esperanza matemática de la relación TP/SL de 5:1. El punto de equilibrio es WR* = SL / (TP + SL) = 0.4 / 2.4 = 16.7%. Con ~25% de aciertos estamos 8 puntos arriba del equilibrio: cada operación ganadora cubre cinco pérdidas pequeñas, dando Profit Factor > 2.',
  ],
  [
    '¿Por qué las 21 operaciones viejas en vivo tenían 81% de Win Rate y aun así perdían (-$10.57)?',
    'Eran de la Etapa 2 (Fibonacci/SuperTrend con TP corto ~0.05%): ganaban +$0.54 en promedio, pero cuando perdían caían −$4.92 (1 acierto no cubría ni un cuarto de una pérdida; su WR de equilibrio era 90.2%). Las simulaciones de Monte Carlo (15,000 combinaciones) probaron esa lección y nos llevaron a Bollinger + EMA 200.',
  ],
  [
    '¿Por qué Bitcoin con 51% de volatilidad puede salir como régimen "BAJO" y Oro con 19% como "ALTO" en Portafolio?',
    'Porque el clasificador Opción 1 evalúa terciles relativos a la propia historia de cada activo (su estado actual vs. sus últimos 5 años): 51% anual para BTC está en su tercio más calmo, mientras 19% para el Oro está en su tercio históricamente más agitado. Además mostramos la volatilidad anual absoluta en la columna contigua y topes por clase (cripto max 5–30%).',
  ],
  [
    '¿Cómo funciona el CAViaR y en qué se diferencia del VaR y CVaR?',
    'El VaR histórico mira una ventana pasada (150 velas) con todos los días pesando igual y tarda en reaccionar a un shock súbito; CVaR promedia el peor 1% de esa ventana. CAViaR (Engle y Manganelli, 2004) actualiza el cuantil cada vela (qₜ = 0.04 + 0.86 qₜ₋₁ + 0.38 |rₜ₋₁|), disparando el freno rojo de inmediato ante volatilidad extrema en cripto.',
  ],
  [
    '¿Qué hace el código ante un corte, latencia o vela con ambos niveles (TP y SL) tocados?',
    'step_auto_trading itera en orden cronológico sobre TODAS las velas cerradas posteriores a la vela de entrada y evalúa primero liquidación, luego Stop Loss (pesimista si toca ambos en la misma vela) y al final Take Profit. El servicio systemd en Google Cloud reinicia automáticamente el proceso si llega a fallar.',
  ],
  [
    '¿Cómo se conecta exactamente el bot en la VM con Telegram y la App Web sin abrir puertos en el servidor?',
    'Todo pasa por Cloud Firestore con escucha en tiempo real (on_snapshot): el bot empuja cada 30 s bot/estado y bot/velas, guarda cada cierre en trades_bot y espeja cada mensaje de Telegram en telegram_espejo. La App Web escribe en comandos/ o consultas/, el bot lo ejecuta en la VM y devuelve el resultado.',
  ],
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

export default function EstrategiaBotView({ onIrABot }) {
  const rootRef = useRef(null);
  const demoBoxRef = useRef(null);
  const eqWrapRef = useRef(null);
  const journeyWrapRef = useRef(null);
  const stratsWrapRef = useRef(null);
  const heatWrapRef = useRef(null);

  const reduced = usePrefersReducedMotion();

  const [widths, setWidths] = useState({ eq: 460, journey: 960, strats: 460, heat: 960 });
  const [tip, setTip] = useState(null);
  const [eqHoverIdx, setEqHoverIdx] = useState(null);
  const [tabDefensa, setTabDefensa] = useState('indicadores');

  // Estado animado del demo en bucle (#demo)
  const [demoFlags, setDemoFlags] = useState({
    a: false,
    b: false,
    c: false,
    m1: false,
    m2: false,
    chip: false,
    zones: false,
    tp: false,
    trend: false,
  });
  const [capIdx, setCapIdx] = useState(0);
  const [capPulse, setCapPulse] = useState(0);

  const showTip = (e, html) => {
    setTip({ x: e.clientX, y: e.clientY, html });
  };
  const moveTip = (e) => {
    setTip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
  };
  const hideTip = () => setTip(null);

  // Medir anchos responsivos para SVG
  useEffect(() => {
    const updateWidths = () => {
      setWidths({
        eq: Math.max(300, eqWrapRef.current?.clientWidth || 460),
        journey: Math.max(300, journeyWrapRef.current?.clientWidth || 960),
        strats: Math.max(300, stratsWrapRef.current?.clientWidth || 460),
        heat: Math.max(640, heatWrapRef.current?.clientWidth || 960),
      });
    };
    updateWidths();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidths);
      return () => window.removeEventListener('resize', updateWidths);
    }
    const ro = new ResizeObserver(updateWidths);
    [eqWrapRef.current, journeyWrapRef.current, stratsWrapRef.current, heatWrapRef.current]
      .filter(Boolean)
      .forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, []);

  // Cálculos principales
  const ratio = -D.win / D.loss;
  const perd = D.n - D.ganadas;
  const gTotal = D.ganadas * D.win;
  const pTotal = -perd * D.loss;

  const cuMap = useMemo(
    () => ({
      pf: [D.pf, f2],
      wr: [Math.round(D.wr), (v) => `${Math.round(v)} %`],
      ra: [ratio, (v) => `${f1(v)}×`],
      n: [D.n, (v) => `${Math.round(v)}`],
      g: [gTotal, (v) => `+${v.toFixed(0)} USDT`],
      p: [pTotal, (v) => `−${v.toFixed(0)} USDT`],
      r: [D.neto, (v) => `+${v.toFixed(0)} USDT`],
      aw: [D.win, (v) => `+${f2(v)} USDT`],
      al: [-D.loss, (v) => `−${f2(v)} USDT`],
    }),
    [ratio, gTotal, pTotal]
  );

  // Scroll-reveal (IntersectionObserver) + Count-Up de números
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const rvNodes = Array.from(
      root.querySelectorAll(
        'header, .est2-kpi, .est2-card, .est2-step, .est2-reason, .est2-gloss > div, .est2-know li, section > h2, section > .lead, footer'
      )
    );
    rvNodes.forEach((el) => {
      el.classList.add('est2-rv');
      const idx = Array.from(el.parentNode?.children || []).indexOf(el) % 4;
      el.style.setProperty('--i', String(Math.max(0, idx)));
    });

    const runCountUp = (node, to, fmt, dur) => {
      if (reduced) {
        node.textContent = fmt(to);
        return;
      }
      const t0 = performance.now();
      const tick = (t) => {
        const p = Math.min(1, Math.max(0, (t - t0) / dur));
        const eased = 1 - Math.pow(1 - p, 3);
        node.textContent = fmt(to * eased);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const reveal = (el) => {
      el.classList.add('in');
      setTimeout(() => {
        el.classList.add('go');
        el.querySelectorAll('[data-cu]').forEach((n) => {
          const entry = cuMap[n.dataset.cu];
          if (entry) runCountUp(n, entry[0], entry[1], 1400);
        });
      }, reduced ? 0 : 240);
      setTimeout(() => el.style.setProperty('--i', '0'), 1600);
    };

    if (reduced || typeof IntersectionObserver === 'undefined') {
      rvNodes.forEach(reveal);
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            io.unobserve(entry.target);
            reveal(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -5% 0px' }
    );
    rvNodes.forEach((el) => io.observe(el));

    return () => io.disconnect();
  }, [cuMap, reduced]);

  // Animación en bucle del demo (#demo) cuando es visible
  useEffect(() => {
    if (reduced) {
      setDemoFlags({
        a: true,
        b: true,
        c: true,
        m1: true,
        m2: true,
        chip: true,
        zones: true,
        tp: true,
        trend: false,
      });
      setCapIdx(4);
      return undefined;
    }

    let timers = [];
    let active = false;

    const clearAll = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };

    const playLoop = () => {
      clearAll();
      setDemoFlags({
        a: false,
        b: false,
        c: false,
        m1: false,
        m2: false,
        chip: false,
        zones: false,
        tp: false,
        trend: false,
      });
      setCapIdx(0);
      setCapPulse((v) => v + 1);

      const at = (ms, fn) => {
        timers.push(setTimeout(fn, ms));
      };
      const turnOn = (key) => setDemoFlags((prev) => ({ ...prev, [key]: true }));

      at(60, () => turnOn('a'));
      at(1500, () => turnOn('m1'));
      at(1900, () => turnOn('b'));
      at(2400, () => turnOn('m2'));
      at(3500, () => {
        setCapIdx(1);
        setCapPulse((v) => v + 1);
        turnOn('trend');
      });
      at(5000, () => {
        setDemoFlags((prev) => ({ ...prev, trend: false }));
        setCapIdx(2);
        setCapPulse((v) => v + 1);
        turnOn('chip');
      });
      at(6500, () => {
        setCapIdx(3);
        setCapPulse((v) => v + 1);
        turnOn('zones');
      });
      at(7300, () => turnOn('c'));
      at(8800, () => {
        turnOn('tp');
        setCapIdx(4);
        setCapPulse((v) => v + 1);
      });
      at(12000, playLoop);
    };

    const host = demoBoxRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') {
      playLoop();
      return clearAll;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !active) {
            active = true;
            playLoop();
          } else if (!entry.isIntersecting && active) {
            active = false;
            clearAll();
          }
        });
      },
      { threshold: 0.35 }
    );
    io.observe(host);

    return () => {
      io.disconnect();
      clearAll();
    };
  }, [reduced]);

  // Gráfica de resultado acumulado (#eq)
  const eqGeom = useMemo(() => {
    const W = widths.eq;
    const H = 250;
    const L = 40;
    const R = 50;
    const T = 12;
    const B = 28;
    const a = [0, ...D.eq];
    const n = a.length - 1;
    const mx = Math.max(...a);
    const mn = Math.min(0, ...a);
    const x = (i) => L + ((W - L - R) * i) / n;
    const y = (v) => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
    const yTicks = [];
    for (let v = 0; v <= mx; v += 20) yTicks.push(v);
    const d = a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const areaD = `${d}L${x(n)},${y(0)}L${x(0)},${y(0)}Z`;
    return { W, H, L, R, T, B, a, n, x, y, yTicks, d, areaD };
  }, [widths.eq]);

  const rowsPorSym = useMemo(() => [...D.por].sort((a, b) => b.pf - a.pf), []);

  // Helper de barras horizontales
  const renderHBars = (rows, width, max) => {
    const wide = width >= 600;
    const L = wide ? Math.min(300, width * 0.34) : 0;
    const R = 54;
    const rh = wide ? 46 : 64;
    const bt = wide ? 4 : 36;
    const h = rows.length * rh + 28;
    const x = (v) => L + ((width - L - R) * v) / max;

    return (
      <svg viewBox={`0 0 ${width} ${h}`} role="img" className="est2-svg">
        {wide ? (
          <line
            x1={x(1)}
            x2={x(1)}
            y1={0}
            y2={rows.length * rh}
            stroke="var(--ink2)"
            strokeDasharray="4 4"
            opacity="0.7"
          />
        ) : (
          rows.map((_, i) => (
            <line
              key={`ref_${i}`}
              x1={x(1)}
              x2={x(1)}
              y1={4 + i * rh + bt - 5}
              y2={4 + i * rh + bt + 25}
              stroke="var(--ink2)"
              strokeDasharray="4 4"
              opacity="0.7"
            />
          ))
        )}
        <text x={x(1)} y={h - 6} textAnchor="middle" fontSize="12">
          Ni gana ni pierde (1.00)
        </text>
        {rows.map((r, i) => {
          const y = 4 + i * rh;
          const barW = Math.max(2, x(r.v) - L);
          const barFill = r.hi ? 'var(--accent)' : r.v < 1 ? 'var(--bad)' : 'var(--mute)';
          const valX = r.v < 1 ? Math.max(x(r.v), x(1)) + 8 : x(r.v) + 8;
          return (
            <g key={r.n}>
              <text
                x="0"
                y={y + 15}
                className="ink"
                fontSize="14"
                fontWeight={r.hi ? 650 : 500}
              >
                {r.n}
              </text>
              <text
                x={wide ? 0 : width}
                y={wide ? y + 32 : y + 15}
                fontSize="12"
                textAnchor={wide ? 'start' : 'end'}
              >
                {r.s}
              </text>
              <rect
                x={L}
                y={y + bt}
                width={barW}
                height={wide ? 28 : 20}
                fill={barFill}
                rx="5"
                className="bar"
                style={{ transformOrigin: `${L}px ${y}px`, '--i': i, cursor: 'pointer' }}
                onMouseMove={(e) => showTip(e, r.t)}
                onMouseLeave={hideTip}
              />
              <text
                x={valX}
                y={y + bt + (wide ? 19 : 15)}
                className="ink num halo val"
                fontWeight="650"
                fontSize="14"
                style={{ '--i': i }}
              >
                {f2(r.v)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div ref={rootRef} className="est2-page">
      <div className="est2-wrap">
        <header>
          <div className="est2-header-top">
            <div>
              <span className="eyebrow">
                <i className="dot" />
                Estrategia del bot
              </span>
              <h1>Bollinger a favor de la tendencia</h1>
              <p>
                Qué hace el bot cuando opera, por qué elegimos esta estrategia entre todas las que
                probamos y cómo les fue a las demás. Todo con precios reales, en simulación: no se
                usa dinero real.
              </p>
            </div>
            {onIrABot && (
              <button type="button" className="portafolio-calc-btn" onClick={onIrABot}>
                Ir a Trading (bot) →
              </button>
            )}
          </div>
        </header>

        {/* 1. KPIs */}
        <section>
          <div className="est2-kpis">
            <div className="est2-kpi main">
              <span className="k">Profit factor (XRP, sin filtro)</span>
              <span className="v" data-cu="pf">
                {f2(D.pf)}
              </span>
              <span className="n">IC 95%: 1.36 – 3.38 (meta &gt; 1.20)</span>
            </div>
            <div className="est2-kpi">
              <span className="k">Win rate</span>
              <span className="v" data-cu="wr">
                {f1(D.wr)} %
              </span>
              <span className="n">Arriba del 16.7% de equilibrio</span>
            </div>
            <div className="est2-kpi">
              <span className="k">Relación TP / SL (ATR)</span>
              <span className="v" data-cu="ra">
                5.0×
              </span>
              <span className="n">TP 2.0 ATR vs SL 0.4 ATR</span>
            </div>
            <div className="est2-kpi">
              <span className="k">Operaciones (XRP 1m)</span>
              <span className="v" data-cu="n">
                {D.n}
              </span>
              <span className="n">22/día · +70 USDT neto (9–15 nov)</span>
            </div>
          </div>
        </section>

        {/* 2. CÓMO FUNCIONA, EN CUATRO PASOS */}
        <section>
          <h2>Cómo funciona, en cuatro pasos</h2>
          <div className="est2-grid2">
            <div ref={demoBoxRef} className="est2-card">
              <h3>Una operación de compra</h3>
              <p className="sub">
                El precio se estira de más hacia abajo y regresa. El bot entra en el regreso.
              </p>
              <div id="est2-demo">
                <svg
                  viewBox="0 0 400 256"
                  role="img"
                  aria-label="Ejemplo de una compra: el precio cae bajo la banda inferior, regresa y el bot compra"
                  className="est2-svg"
                >
                  <path
                    d="M10 70 C90 60 180 76 250 80 S350 58 390 50 L390 180 C350 186 290 196 250 194 S90 188 10 196 Z"
                    fill="var(--accent)"
                    opacity="0.08"
                  />
                  <path
                    d="M10 70 C90 60 180 76 250 80 S350 58 390 50"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M10 196 C90 188 180 192 250 194 S350 184 390 180"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M10 246 L390 220"
                    fill="none"
                    stroke="var(--ink)"
                    strokeWidth="2.2"
                    className={`trend ${demoFlags.trend ? 'on' : ''}`}
                  />
                  <text x="10" y="56" fontSize="13.5">
                    Banda de arriba
                  </text>
                  <text x="10" y="214" fontSize="13.5">
                    Banda de abajo
                  </text>
                  <text
                    x="390"
                    y="244"
                    fontSize="13.5"
                    textAnchor="end"
                    style={{ fill: 'var(--ink)' }}
                  >
                    Tendencia
                  </text>

                  <g className={`fade ${demoFlags.zones ? 'on' : ''}`}>
                    <rect
                      x="250"
                      y="112"
                      width="140"
                      height="66"
                      fill="var(--good)"
                      opacity="0.14"
                    />
                    <rect
                      x="250"
                      y="178"
                      width="140"
                      height="13"
                      fill="var(--bad)"
                      opacity="0.22"
                    />
                    <line
                      x1="250"
                      x2="390"
                      y1="112"
                      y2="112"
                      stroke="var(--good)"
                      strokeWidth="1.6"
                      strokeDasharray="5 4"
                    />
                    <line
                      x1="250"
                      x2="390"
                      y1="191"
                      y2="191"
                      stroke="var(--bad)"
                      strokeWidth="1.6"
                      strokeDasharray="5 4"
                    />
                    <text
                      x="390"
                      y="104"
                      fontSize="13.5"
                      textAnchor="end"
                      style={{ fill: 'var(--good)', fontWeight: 600 }}
                    >
                      Ganancia
                    </text>
                    <text
                      x="390"
                      y="208"
                      fontSize="13.5"
                      textAnchor="end"
                      style={{ fill: 'var(--bad)', fontWeight: 600 }}
                    >
                      Pérdida máxima
                    </text>
                  </g>

                  <path
                    d="M10 130 L45 118 L80 140 L115 124 L150 154 L185 172 L220 206"
                    pathLength="1"
                    fill="none"
                    stroke="var(--ink)"
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    className={`seg ${demoFlags.a ? 'on' : ''}`}
                    style={{ '--d': '1.5s' }}
                  />
                  <path
                    d="M220 206 L250 178"
                    pathLength="1"
                    fill="none"
                    stroke="var(--ink)"
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    className={`seg ${demoFlags.b ? 'on' : ''}`}
                    style={{ '--d': '.5s' }}
                  />
                  <path
                    d="M250 178 L282 160 L312 142 L342 112"
                    pathLength="1"
                    fill="none"
                    stroke="var(--ink)"
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    className={`seg ${demoFlags.c ? 'on' : ''}`}
                    style={{ '--d': '1.5s' }}
                  />

                  <g
                    className={`pop ${demoFlags.m1 ? 'on' : ''}`}
                    style={{ transformOrigin: '220px 206px' }}
                  >
                    <circle
                      cx="220"
                      cy="206"
                      r="11"
                      fill="var(--accent)"
                      stroke="var(--surface)"
                      strokeWidth="2"
                    />
                    <text
                      x="220"
                      y="210"
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight="700"
                      style={{ fill: '#0b0b13' }}
                    >
                      1
                    </text>
                  </g>

                  <g
                    className={`pop ${demoFlags.m2 ? 'on' : ''}`}
                    style={{ transformOrigin: '250px 178px' }}
                  >
                    <circle
                      cx="250"
                      cy="178"
                      r="11"
                      fill="var(--accent)"
                      stroke="var(--surface)"
                      strokeWidth="2"
                    />
                    <text
                      x="250"
                      y="182"
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight="700"
                      style={{ fill: '#0b0b13' }}
                    >
                      2
                    </text>
                  </g>

                  <g
                    className={`pop ${demoFlags.chip ? 'on' : ''}`}
                    style={{ transformOrigin: '330px 24px' }}
                  >
                    <rect
                      x="270"
                      y="10"
                      width="120"
                      height="28"
                      rx="14"
                      fill="var(--goodbg)"
                      stroke="var(--good)"
                    />
                    <text
                      x="330"
                      y="29"
                      textAnchor="middle"
                      fontSize="13"
                      fontWeight="600"
                      style={{ fill: 'var(--good)' }}
                    >
                      Modelo: sí ✓
                    </text>
                  </g>

                  <g
                    className={`pop ${demoFlags.tp ? 'on' : ''}`}
                    style={{ transformOrigin: '342px 112px' }}
                  >
                    <circle cx="342" cy="112" r="13" fill="var(--good)" opacity="0.25" />
                    <circle
                      cx="342"
                      cy="112"
                      r="6.5"
                      fill="var(--good)"
                      stroke="var(--surface)"
                      strokeWidth="2"
                    />
                  </g>
                </svg>
              </div>
              <p key={capPulse} className="est2-cap sw">
                <b>{DEMO_CAPS[capIdx][0]}</b>
                <span>{DEMO_CAPS[capIdx][1]}</span>
              </p>
            </div>

            <div className="est2-steps">
              {DEMO_PASOS.map(([tit, desc], idx) => (
                <div
                  key={tit}
                  className={`est2-step ${Math.min(capIdx, 3) === idx ? 'on' : ''}`}
                >
                  <span className="n" />
                  <b>{tit}</b>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 3. POR QUÉ GANA AUNQUE FALLA 3 DE CADA 4 */}
        <section>
          <h2>Por qué gana aunque falla 3 de cada 4</h2>
          <p className="lead">
            No busca acertar siempre. Busca que cada acierto valga mucho más que cada error.
          </p>
          <div className="est2-grid2">
            <div className="est2-card">
              <h3>La cuenta completa</h3>
              <p className="sub">229 operaciones simuladas, en dólares (USDT).</p>
              <div className="est2-tally">
                <span>{D.ganadas} aciertos</span>
                <div className="trk">
                  <div className="fill" style={{ width: '100%', background: 'var(--good)', '--i': 0 }} />
                </div>
                <span className="v" style={{ color: 'var(--good)' }} data-cu="g">
                  {cuMap.g[1](gTotal)}
                </span>

                <span>{perd} errores</span>
                <div className="trk">
                  <div
                    className="fill"
                    style={{
                      width: `${(pTotal / gTotal) * 100}%`,
                      background: 'var(--bad)',
                      '--i': 1,
                    }}
                  />
                </div>
                <span className="v" style={{ color: 'var(--bad)' }} data-cu="p">
                  {cuMap.p[1](pTotal)}
                </span>

                <span>
                  <b>Resultado</b>
                </span>
                <div className="trk">
                  <div
                    className="fill"
                    style={{
                      width: `${(D.neto / gTotal) * 100}%`,
                      background: 'var(--accent)',
                      '--i': 2,
                    }}
                  />
                </div>
                <span className="v" style={{ color: 'var(--accent2)' }} data-cu="r">
                  {cuMap.r[1](D.neto)}
                </span>
              </div>

              <p className="sub" style={{ margin: '12px 0 0' }}>
                Ganó el doble de lo que perdió: eso es un profit factor de 2.
              </p>
              <div className="est2-pair">
                <div>
                  <span>Un acierto promedio</span>
                  <b style={{ color: 'var(--good)' }} data-cu="aw">
                    {cuMap.aw[1](D.win)}
                  </b>
                </div>
                <div>
                  <span>Un error promedio</span>
                  <b style={{ color: 'var(--bad)' }} data-cu="al">
                    {cuMap.al[1](-D.loss)}
                  </b>
                </div>
              </div>
            </div>

            <div className="est2-card">
              <h3>Cómo fue creciendo el resultado</h3>
              <p className="sub">
                Cada punto es una operación. Sube de golpe cuando acierta y baja poquito cuando
                falla.
              </p>
              <div ref={eqWrapRef}>
                <svg
                  viewBox={`0 0 ${eqGeom.W} ${eqGeom.H}`}
                  role="img"
                  aria-label="Resultado acumulado de las 229 operaciones"
                  className="est2-svg"
                >
                  {eqGeom.yTicks.map((v) => (
                    <g key={`eq_y_${v}`}>
                      <line
                        x1={eqGeom.L}
                        x2={eqGeom.W - eqGeom.R}
                        y1={eqGeom.y(v)}
                        y2={eqGeom.y(v)}
                        className="grid"
                      />
                      <text
                        x={eqGeom.L - 8}
                        y={eqGeom.y(v) + 4}
                        textAnchor="end"
                        className="num"
                      >
                        {v > 0 ? `+${v}` : v}
                      </text>
                    </g>
                  ))}
                  {[0, 25, 50, 75, 100, 125].map((i) => (
                    <text
                      key={`eq_x_${i}`}
                      x={eqGeom.x(i)}
                      y={eqGeom.H - 8}
                      textAnchor="middle"
                      className="num"
                    >
                      {i}
                    </text>
                  ))}
                  <path
                    d={eqGeom.areaD}
                    fill="var(--accent)"
                    fillOpacity="0.12"
                    className="late"
                    style={{ '--dl': '1.5s' }}
                  />
                  <path
                    d={eqGeom.d}
                    pathLength="1"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                    className="draw"
                  />
                  <circle
                    cx={eqGeom.x(eqGeom.n)}
                    cy={eqGeom.y(eqGeom.a[eqGeom.n])}
                    r="5"
                    fill="var(--accent2)"
                    stroke="var(--surface)"
                    strokeWidth="2"
                    className="late"
                    style={{ '--dl': '2.4s' }}
                  />
                  <text
                    x={eqGeom.x(eqGeom.n) + 9}
                    y={eqGeom.y(eqGeom.a[eqGeom.n]) + 4}
                    className="ink num late"
                    fontWeight="650"
                    fontSize="13"
                    style={{ '--dl': '2.4s' }}
                  >
                    +{eqGeom.a[eqGeom.n].toFixed(0)}
                  </text>
                  {eqHoverIdx !== null && (
                    <circle
                      cx={eqGeom.x(eqHoverIdx)}
                      cy={eqGeom.y(eqGeom.a[eqHoverIdx])}
                      r="4"
                      fill="var(--ink)"
                    />
                  )}
                  <rect
                    x={eqGeom.L}
                    y={eqGeom.T}
                    width={eqGeom.W - eqGeom.L - eqGeom.R}
                    height={eqGeom.H - eqGeom.T - eqGeom.B}
                    fill="transparent"
                    style={{ cursor: 'crosshair' }}
                    onMouseMove={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      const i = Math.max(
                        1,
                        Math.min(
                          eqGeom.n,
                          Math.round(((e.clientX - r.left) / r.width) * eqGeom.n)
                        )
                      );
                      setEqHoverIdx(i);
                      const dv = eqGeom.a[i] - eqGeom.a[i - 1];
                      showTip(
                        e,
                        `<b>Operación ${i}</b> · ${D.sym[i - 1]}<br>${
                          dv >= 0 ? 'Acierto +' : 'Error −'
                        }${Math.abs(dv).toFixed(2)} USDT<br>Acumulado ${
                          eqGeom.a[i] >= 0 ? '+' : '−'
                        }${Math.abs(eqGeom.a[i]).toFixed(2)}`
                      );
                    }}
                    onMouseLeave={() => {
                      setEqHoverIdx(null);
                      hideTip();
                    }}
                  />
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* 4. POR QUÉ ELEGIMOS ESTA */}
        <section>
          <h2>Por qué elegimos esta</h2>
          <p className="lead">
            Llegamos aquí después de probar seis configuraciones. La barra muestra cuánto ganó cada
            una por cada dólar perdido; la línea punteada es el punto donde no se gana ni se pierde.
          </p>
          <div className="est2-card">
            <div className="est2-legend">
              <span>
                <i style={{ background: 'var(--accent)' }} />
                La que elegimos
              </span>
              <span>
                <i style={{ background: 'var(--mute)' }} />
                Las anteriores
              </span>
              <span>
                <i style={{ background: 'var(--bad)' }} />
                Perdía dinero
              </span>
            </div>
            <div ref={journeyWrapRef}>
              {renderHBars(JOURNEY_DATA, widths.journey, 2.3)}
            </div>
          </div>

          <div className="est2-reasons">
            <div className="est2-reason">
              <b>Acertar mucho no era ganar</b>
              <span>
                Una versión acertaba 9 de cada 10 y aun así perdía: cada error borraba diez
                aciertos.
              </span>
            </div>
            <div className="est2-reason">
              <b>Seguir la tendencia fue la clave</b>
              <span>
                Las mismas señales ganaban a favor de la tendencia y quedaban en cero en contra.
              </span>
            </div>
            <div className="est2-reason">
              <b>Elegida entre 297 combinaciones</b>
              <span>
                Probamos 297 combinaciones de ganancia y pérdida. Esta quedó entre las mejores, ganó
                6 de los 7 días y en las cuatro criptomonedas.
              </span>
            </div>
          </div>
        </section>

        {/* 5. CÓMO LES FUE A LAS DEMÁS */}
        <section>
          <h2>Cómo les fue a las demás</h2>
          <div className="est2-grid2">
            <div className="est2-card">
              <h3>Las estrategias del bot, comparadas</h3>
              <p className="sub">Misma criptomoneda (XRP) y mismas reglas de salida para todas.</p>
              <div ref={stratsWrapRef}>
                {renderHBars(
                  STRATS_DATA.map((r) => ({
                    ...r,
                    t: `<b>${r.n}</b><br>${f2(r.v)} por cada dólar perdido`,
                  })),
                  widths.strats,
                  2.0
                )}
              </div>
            </div>

            <div className="est2-card est2-scroll">
              <h3>El filtro de tendencia decide, por criptomoneda</h3>
              <p className="sub">Profit factor de Bollinger a favor vs. en contra de la EMA 200 (1 min).</p>
              <table className="est2-table">
                <thead>
                  <tr>
                    <th>Criptomoneda</th>
                    <th>A favor (EMA 200)</th>
                    <th>En contra</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsPorSym.map((r) => (
                    <tr key={r.sym}>
                      <td>{r.nombre}</td>
                      <td style={{ color: 'var(--good)' }}>{f2(r.pf)}</td>
                      <td style={{ color: r.pfContra < 1 ? 'var(--bad)' : 'var(--ink2)' }}>
                        {f2(r.pfContra)}
                      </td>
                    </tr>
                  ))}
                  <tr className="hi">
                    <td>4 criptos (versión final sin filtro RF)</td>
                    <td style={{ color: 'var(--good)' }}>1.64 (491 ops)</td>
                    <td>2.00 con filtro (229 ops)</td>
                  </tr>
                </tbody>
              </table>
              <p className="sub" style={{ marginTop: '10px', marginBottom: 0 }}>
                En XRP (versión final sin bloqueo RF): 133 ops · WR 24.8% · PF 2.25 · +69.54 USDT.
              </p>
            </div>
          </div>

          <div className="est2-card">
            <h3>Las combinaciones que probamos</h3>
            <p className="sub">
              Cada casilla es una combinación: qué tan lejos se pone la ganancia (filas) y qué tan
              lejos la pérdida (columnas). Entre más morado, mejor resultado. El recuadro blanco es
              la que elegimos.
            </p>
            <div className="est2-legend">
              <span>
                <i style={{ background: 'var(--accent)' }} />
                Gana más
              </span>
              <span>
                <i style={{ background: 'var(--surface2)', border: '1px solid var(--line)' }} />
                Empata
              </span>
            </div>
            <div className="est2-scroll">
              <div ref={heatWrapRef} style={{ minWidth: '640px' }}>
                {(() => {
                  const W = widths.heat;
                  const L = 132;
                  const T = 52;
                  const nC = D.sls.length;
                  const nR = D.tps.length;
                  const cw = (W - L - 6) / nC;
                  const ch = 46;
                  const h = T + nR * ch + 6;
                  return (
                    <svg
                      viewBox={`0 0 ${W} ${h}`}
                      role="img"
                      aria-label="Profit factor de cada combinación de ganancia y pérdida"
                      className="est2-svg"
                    >
                      <text x={L + (W - L) / 2} y="16" textAnchor="middle">
                        Qué tan lejos se pone la pérdida (veces el movimiento normal del precio)
                      </text>
                      {D.sls.map((v, j) => (
                        <text
                          key={`sl_${v}`}
                          x={L + j * cw + cw / 2}
                          y="42"
                          textAnchor="middle"
                          className="num ink"
                        >
                          {v}
                        </text>
                      ))}
                      {D.heat.map((row, i) => (
                        <g key={`tp_${D.tps[i]}`}>
                          <text
                            x={L - 12}
                            y={T + i * ch + ch / 2 + 4}
                            textAnchor="end"
                            className="ink"
                          >
                            Ganancia a {D.tps[i]}
                          </text>
                          {row.map((v, j) => {
                            const a = Math.min(1, Math.max(0, (v - 1) / 1.3));
                            const isChoice = D.tps[i] === 2 && D.sls[j] === 0.4;
                            const cx = L + j * cw + cw / 2;
                            const cy = T + i * ch + ch / 2;
                            return (
                              <g key={`cell_${i}_${j}`}>
                                <rect
                                  x={L + j * cw + 2}
                                  y={T + i * ch + 2}
                                  width={cw - 4}
                                  height={ch - 4}
                                  rx="6"
                                  fill={v >= 1 ? 'var(--accent)' : 'var(--bad)'}
                                  fillOpacity={v >= 1 ? 0.1 + 0.85 * a : 0.35}
                                  className="cell"
                                  style={{
                                    transformOrigin: `${cx}px ${cy}px`,
                                    '--k': i + j,
                                    cursor: 'pointer',
                                  }}
                                  onMouseMove={(e) =>
                                    showTip(
                                      e,
                                      `Ganancia a ${D.tps[i]} · pérdida a ${D.sls[j]}<br><b>${f2(
                                        v
                                      )}</b> por cada dólar perdido<br>Acierta ${D.wrh[i][j]} de cada 100`
                                    )
                                  }
                                  onMouseLeave={hideTip}
                                />
                                <text
                                  x={cx}
                                  y={cy + 5}
                                  textAnchor="middle"
                                  className="num ink ctx"
                                  fontWeight="650"
                                  fontSize="14"
                                  style={{ '--k': i + j, pointerEvents: 'none' }}
                                >
                                  {f2(v)}
                                </text>
                                {isChoice && (
                                  <rect
                                    x={L + j * cw + 2}
                                    y={T + i * ch + 2}
                                    width={cw - 4}
                                    height={ch - 4}
                                    rx="6"
                                    fill="none"
                                    stroke="#ffffff"
                                    strokeWidth="3"
                                    className="ring late"
                                    style={{ '--dl': '1.1s', pointerEvents: 'none' }}
                                  />
                                )}
                              </g>
                            );
                          })}
                        </g>
                      ))}
                    </svg>
                  );
                })()}
              </div>
            </div>
          </div>
        </section>

        {/* 5B. COMPARATIVA DEL FILTRO RF Y ETAPA 2 EN VIVO */}
        <section>
          <span className="est2-step-tag">Versión final sin filtro RF · Validación cuantitativa</span>
          <h2>Por qué eliminamos el filtro RF (comparativa del backtest del código)</h2>
          <p className="est2-lead">
            En <b>XRP (1 minuto, TP 2.0 / SL 0.4 ATR)</b>, el filtro estricto del Random Forest
            hacía apenas <b>9 operaciones al día</b> y pasaba hasta 15 horas sin operar. Al quitar
            el filtro de entrada, el bot opera el doble (<b>22/día, +70 USDT</b>), manteniendo un{' '}
            <b>Profit Factor de 2.25</b> (muy arriba de la meta de 1.2) y usando el RF solo para
            decidir cuándo subir el apalancamiento a <b>x15 en XRP</b> (simulación de 1 semana, sin
            comisiones ni deslizamiento):
          </p>
          <div className="est2-card" style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: '13px' }}>
              <thead>
                <tr>
                  <th>CONFIGURACIÓN / ESCENARIO</th>
                  <th className="num">OPERACIONES</th>
                  <th className="num">POR DÍA</th>
                  <th className="num">WIN RATE</th>
                  <th className="num">PROFIT FACTOR</th>
                  <th className="num">RESULTADO NETO</th>
                  <th>NOTAS DE AUDITORÍA</th>
                </tr>
              </thead>
              <tbody>
                <tr className="row-best">
                  <td>
                    <b>1. Versión final SIN filtro RF (XRP, 1m) ★</b>
                  </td>
                  <td className="num">133</td>
                  <td className="num">22</td>
                  <td className="num">24.8%</td>
                  <td className="num text-green">
                    <b>2.25</b>
                  </td>
                  <td className="num text-green">
                    <b>+70 USDT</b>
                  </td>
                  <td>TP 2.0 ATR · SL 0.4 ATR · RF solo ajusta x15</td>
                </tr>
                <tr>
                  <td>2. Con filtro Veto (solo bloquea lo contrario, XRP)</td>
                  <td className="num">97</td>
                  <td className="num">16</td>
                  <td className="num">28.9%</td>
                  <td className="num text-green">2.63</td>
                  <td className="num text-green">+64 USDT</td>
                  <td>Descarta cuando el RF predice lado opuesto</td>
                </tr>
                <tr>
                  <td>3. Con filtro Estricto (exige confirmación RF, XRP)</td>
                  <td className="num">58</td>
                  <td className="num">9</td>
                  <td className="num">32.8%</td>
                  <td className="num text-green">3.53</td>
                  <td className="num text-green">+59 USDT</td>
                  <td>Pasaba hasta 15 h sin operar</td>
                </tr>
                <tr>
                  <td>4. 4 criptos (XRP, BTC, ETH, SOL — sin filtro vs. filtro estricto)</td>
                  <td className="num">491 / 229</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num text-green">1.64 / 2.00</td>
                  <td className="num text-sec">Sin comisiones</td>
                  <td>Datos del backtest de 1 semana (9–15 nov 2026)</td>
                </tr>
                <tr>
                  <td>5. Historial en vivo previo — Etapa 2 (Fibonacci / SuperTrend)</td>
                  <td className="num">21</td>
                  <td className="num">—</td>
                  <td className="num">81.0%</td>
                  <td className="num text-red">0.46</td>
                  <td className="num text-red">−10.57 USDT</td>
                  <td>Etapa de «acertar mucho» (TP ~0.05% &lt; comisión) que motivó el cambio</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 6. LO QUE DEBES SABER */}
        <section>
          <h2>Lo que debes saber</h2>
          <ul className="est2-know">
            <li>
              <b>Sin bloqueo de entradas por Random Forest (versión final).</b> Como la prueba de
              Diebold-Mariano mostró que el RF supera a CatBoost (DM −3.11, p = 0.002) pero no a la
              caminata aleatoria (DM +1.11, p = 0.27), y el ATR pronostica mejor el rango (p &lt;
              0.001), el bot entra directo por Bollinger + EMA 200 y fija salidas con ATR.
            </li>
            <li>
              <b>El Random Forest sigue en el bot para apalancamiento dinámico.</b> Cuando la
              probabilidad a favor y el valor esperado son altos en XRP, sube el apalancamiento de
              x10 a x15.
            </li>
            <li>
              <b>133 operaciones en XRP (9 al 15 de noviembre de 2026).</b> 22 operaciones al día,
              Profit Factor 2.25 (IC bootstrap 95%: 1.36 a 3.38) y +70 USDT neto sobre 1,000 USDT.
            </li>
            <li>
              <b>Habrá rachas de errores.</b> Con 24.8% de aciertos es normal ver varias pérdidas
              pequeñas seguidas antes de una ganancia grande (5 : 1).
            </li>
            <li>
              <b>Resultados pasados no garantizan resultados futuros.</b>
            </li>
          </ul>
        </section>

        {/* 6B. GUÍA DE DEFENSA INDIVIDUAL: INDICADORES, RIESGO, ML Y PREGUNTAS */}
        <section>
          <span className="est2-step-tag">Material de estudio y defensa oral</span>
          <h2>Guía de Defensa Individual: Indicadores, Riesgo, ML y Preguntas del Profesor</h2>
          <p className="est2-lead">
            Referencia técnica completa de cada fórmula, algoritmo y decisión implementada en el
            código del bot (<code style={{ color: 'var(--accent2)' }}>bot_trading.py</code>) y en
            los portafolios de inversión:
          </p>

          <div
            className="bot-results-filters"
            role="tablist"
            aria-label="Secciones de la guía técnica"
            style={{ marginBottom: '14px', flexWrap: 'wrap' }}
          >
            {GLOSARIO_DEFENSA_TABS.map((tb) => (
              <button
                key={tb.id}
                type="button"
                role="tab"
                aria-selected={tabDefensa === tb.id}
                className={`bot-results-pill ${tabDefensa === tb.id ? 'is-active' : ''}`}
                onClick={() => setTabDefensa(tb.id)}
              >
                {tb.label}
              </button>
            ))}
          </div>

          {tabDefensa === 'indicadores' && (
            <div className="est2-grid2">
              {INDICADORES_BOT_GUIA.map((item) => (
                <div key={item.titulo} className="est2-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '15px' }}>{item.titulo}</h3>
                  <div
                    className="num"
                    style={{
                      fontSize: '12px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      background: 'rgba(143, 107, 255, 0.08)',
                      border: '1px solid rgba(143, 107, 255, 0.25)',
                      color: 'var(--accent2)',
                      wordBreak: 'break-word',
                    }}
                  >
                    {item.formula}
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink2)', lineHeight: 1.5 }}>
                    <b style={{ color: 'var(--ink)' }}>Qué es:</b> {item.queEs}
                  </p>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink2)', lineHeight: 1.5 }}>
                    <b style={{ color: 'var(--good)' }}>Regla en el bot:</b> {item.reglaBot}
                  </p>
                </div>
              ))}
            </div>
          )}

          {tabDefensa === 'riesgo' && (
            <div className="est2-grid2">
              {RIESGO_BOT_GUIA.map((item) => (
                <div key={item.titulo} className="est2-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '15px' }}>{item.titulo}</h3>
                  <div
                    className="num"
                    style={{
                      fontSize: '12px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      background: 'rgba(53, 201, 138, 0.08)',
                      border: '1px solid rgba(53, 201, 138, 0.25)',
                      color: 'var(--good)',
                      wordBreak: 'break-word',
                    }}
                  >
                    {item.formula}
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink2)', lineHeight: 1.55 }}>
                    {item.detalle}
                  </p>
                </div>
              ))}
            </div>
          )}

          {tabDefensa === 'ml' && (
            <div className="est2-grid2">
              {ML_BOT_GUIA.map((item) => (
                <div key={item.titulo} className="est2-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '15px' }}>{item.titulo}</h3>
                  <div
                    className="num"
                    style={{
                      fontSize: '12px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      background: 'rgba(143, 107, 255, 0.08)',
                      border: '1px solid rgba(143, 107, 255, 0.25)',
                      color: 'var(--accent2)',
                      wordBreak: 'break-word',
                    }}
                  >
                    {item.formula}
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink2)', lineHeight: 1.55 }}>
                    {item.detalle}
                  </p>
                </div>
              ))}
            </div>
          )}

          {tabDefensa === 'preguntas' && (
            <div className="est2-grid2">
              {PREGUNTAS_PROFESOR_GUIA.map(([preg, resp]) => (
                <div key={preg} className="est2-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '14.5px', color: 'var(--accent2)' }}>
                    {preg}
                  </h3>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink2)', lineHeight: 1.55 }}>
                    {resp}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 7. PALABRAS QUE USAMOS */}
        <section>
          <h2>Palabras que usamos</h2>
          <div className="est2-gloss">
            {GLOSARIO_ESTRATEGIA.map(([term, def]) => (
              <div key={term}>
                <b>{term}</b>
                <span>{def}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="est2-footer">
          Datos: velas de 1 minuto de futuros en Gate.io (XRP, BTC, ETH y SOL). Simulación con el
          mismo código real del bot. Proyecto Final Integrador, Finanzas Computacionales.
        </footer>
      </div>

      {tip && (
        <div
          id="est2-tip"
          role="status"
          style={{
            left: Math.min(window.innerWidth - 260, tip.x + 14),
            top: Math.max(10, tip.y + 14),
          }}
          dangerouslySetInnerHTML={{ __html: tip.html }}
        />
      )}
    </div>
  );
}
