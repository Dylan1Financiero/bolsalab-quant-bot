const ESCALAS_BASE = [0.012, 0.31, 1.7, 24, 610];
export const TIEMPO_BASE = 1700000000;
export const SEGUNDOS_DIA = 86400;

export const COLORES_ROL = {
  resistencia: '#f0506e', // rojo
  soporte: '#22c58b',     // verde
  cuello: '#a78bfa',      // lila
  fibonacci: '#f5b83d',   // ámbar
};

function aleatorio(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Elige una escala aleatoria según la Sección 5.3:
 * uno de [0.012, 0.31, 1.7, 24, 610] × aleatorio(0.8–1.2)
 */
export function elegirEscalaAleatoria() {
  const base = ESCALAS_BASE[Math.floor(Math.random() * ESCALAS_BASE.length)];
  return base * aleatorio(0.8, 1.2);
}

/**
 * Genera las velas de una serie de puntos [[x0, y0], [x1, y1], ...]
 * siguiendo el algoritmo exacto de la Sección 5.3.
 */
function generarTramos(puntos, escala, cierreInicial = null) {
  if (!Array.isArray(puntos) || puntos.length < 2) return [];

  const velas = [];
  let cierreAnterior = cierreInicial;

  for (let i = 0; i < puntos.length - 1; i++) {
    const [x0, y0] = puntos[i];
    const [x1, y1] = puntos[i + 1];
    const inicioX = i === 0 && cierreInicial === null ? x0 : x0 + 1;

    for (let x = inicioX; x <= x1; x++) {
      const t = x1 === x0 ? 1 : (x - x0) / (x1 - x0);
      const yInterp = y0 + (y1 - y0) * t;

      // Ruido uniforme en ±1.1, cero exactamente en los puntos clave
      const esPuntoClave = x === x0 || x === x1;
      const ruido = esPuntoClave ? 0 : aleatorio(-1.1, 1.1);

      const cierre = (yInterp + ruido) * escala;
      const apertura =
        cierreAnterior !== null
          ? cierreAnterior
          : (y0 + aleatorio(-0.35, 0.35)) * escala;

      const maxAC = Math.max(apertura, cierre);
      const minAC = Math.min(apertura, cierre);
      const maximo = maxAC + aleatorio(0, 0.9) * escala;
      const minimo = minAC - aleatorio(0, 0.9) * escala;

      velas.push({
        x,
        time: TIEMPO_BASE + x * SEGUNDOS_DIA,
        open: Number(apertura.toFixed(6)),
        high: Number(maximo.toFixed(6)),
        low: Number(minimo.toFixed(6)),
        close: Number(cierre.toFixed(6)),
      });

      cierreAnterior = cierre;
    }
  }

  return velas;
}

/**
 * Genera el paquete completo de una figura chartista (velas de formación,
 * velas de continuación, líneas punteadas escaladas y marcador de ruptura).
 */
export function generarEscenarioFigura(figura) {
  const escala = elegirEscalaAleatoria();

  const velasFormacion = generarTramos(figura.puntos, escala, null);
  const ultimaVelaFormacion = velasFormacion[velasFormacion.length - 1];
  const ultimoPuntoFormacion = figura.puntos[figura.puntos.length - 1];

  // La continuación empieza en el último punto de `puntos`
  const puntosContinuacion = [ultimoPuntoFormacion, ...(figura.continuacion || [])];
  const velasContinuacion = generarTramos(
    puntosContinuacion,
    escala,
    ultimaVelaFormacion ? ultimaVelaFormacion.close : null
  );

  const todasLasVelas = [...velasFormacion, ...velasContinuacion];

  // Líneas punteadas escaladas con color según rol
  const lineasEscaladas = (figura.lineas || []).map((lin) => {
    const [x1, y1] = lin.desde;
    const [x2, y2] = lin.hasta;
    const puntosLinea = [];
    const paso = x2 >= x1 ? 1 : -1;
    for (let x = x1; paso > 0 ? x <= x2 : x >= x2; x += paso) {
      const frac = x2 === x1 ? 0 : (x - x1) / (x2 - x1);
      const y = y1 + (y2 - y1) * frac;
      puntosLinea.push({
        time: TIEMPO_BASE + x * SEGUNDOS_DIA,
        value: Number((y * escala).toFixed(6)),
      });
    }
    return {
      rol: lin.rol,
      color: COLORES_ROL[lin.rol] || '#a78bfa',
      datos: puntosLinea,
    };
  });

  // Marcador en la vela `ruptura`: arriba si baja, abajo si sube
  const esBaja = figura.direccion === 'baja';
  const marcadorRuptura =
    typeof figura.ruptura === 'number'
      ? {
          time: TIEMPO_BASE + figura.ruptura * SEGUNDOS_DIA,
          position: esBaja ? 'aboveBar' : 'belowBar',
          color: esBaja ? '#f0506e' : '#22c58b',
          shape: esBaja ? 'arrowDown' : 'arrowUp',
          text: figura.etiqueta || 'Ruptura',
        }
      : null;

  let precision = 2;
  let minMove = 0.01;
  if (escala < 0.05) {
    precision = 5;
    minMove = 0.00001;
  } else if (escala < 1) {
    precision = 4;
    minMove = 0.0001;
  } else if (escala > 100) {
    precision = 1;
    minMove = 0.1;
  }

  return {
    escala,
    precision,
    minMove,
    velasFormacion,
    velasContinuacion,
    todasLasVelas,
    lineasEscaladas,
    marcadorRuptura,
  };
}

/**
 * Calcula el nivel actual, el progreso % y cuánto XP falta según `niveles` del JSON.
 */
export function calcularNivelUsuario(xpActual = 0, niveles = []) {
  const xp = Math.max(0, Number(xpActual || 0));
  if (!niveles.length) {
    return {
      indice: 1,
      nombre: 'Novato',
      xpActual: xp,
      xpSiguiente: 50,
      faltan: Math.max(0, 50 - xp),
      progresoPct: Math.min(100, (xp / 50) * 100),
      esMaximo: false,
    };
  }

  let idx = 0;
  for (let i = 0; i < niveles.length; i++) {
    if (xp >= niveles[i].xp) {
      idx = i;
    }
  }

  const actual = niveles[idx];
  const siguiente = niveles[idx + 1] || null;

  if (!siguiente) {
    return {
      indice: idx + 1,
      nombre: actual.nombre,
      xpActual: xp,
      xpSiguiente: actual.xp,
      faltan: 0,
      progresoPct: 100,
      esMaximo: true,
    };
  }

  const rango = Math.max(1, siguiente.xp - actual.xp);
  const avance = xp - actual.xp;
  const progresoPct = Math.min(100, Math.max(0, (avance / rango) * 100));

  return {
    indice: idx + 1,
    nombre: actual.nombre,
    xpActual: xp,
    xpSiguiente: siguiente.xp,
    nombreSiguiente: siguiente.nombre,
    faltan: Math.max(0, siguiente.xp - xp),
    progresoPct,
    esMaximo: false,
  };
}
