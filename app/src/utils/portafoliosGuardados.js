import { MAPA_ACTIVOS } from '../data/catalogo';

export const COLORES_PORTAFOLIO = [
  '#8B5CF6',
  '#22C55E',
  '#3B82F6',
  '#EAB308',
  '#EF4444',
  '#06B6D4',
  '#F97316',
  '#EC4899',
];

/**
 * Normaliza la lista ordenada de portafolios invertidos del usuario.
 * Si solo existe el campo legado `portafolioLargoPlazo`, lo adapta como Portafolio 1.
 */
export function normalizarPortafoliosInvertidos(perfil) {
  const rawLista = Array.isArray(perfil?.portafoliosInvertidos)
    ? perfil.portafoliosInvertidos
    : [];

  let base = rawLista.filter(
    (p) => p && Array.isArray(p.objetivoPesos) && p.objetivoPesos.length > 0
  );

  if (
    base.length === 0 &&
    perfil?.portafolioLargoPlazo &&
    Array.isArray(perfil.portafolioLargoPlazo.objetivoPesos) &&
    perfil.portafolioLargoPlazo.objetivoPesos.length > 0
  ) {
    base = [perfil.portafolioLargoPlazo];
  }

  return base
    .map((p, idx) => {
      const numero =
        Number.isFinite(Number(p.numero)) && Number(p.numero) > 0
          ? Math.round(Number(p.numero))
          : idx + 1;
      const capitalBase = Number(p.capitalInicial || 0);
      const sumaMontos = p.objetivoPesos.reduce(
        (acc, it) => acc + Number(it?.montoUSD || capitalBase * Number(it?.peso || 0)),
        0
      );
      const cap = capitalBase > 0 ? capitalBase : sumaMontos;
      return {
        id: String(p.id || p.portafolioId || `portafolio-${numero}`),
        numero,
        alias: p.alias || `Portafolio ${numero}`,
        nombreCartera: p.nombreCartera || 'Cartera ML',
        perfil: p.perfil || 'conservador',
        contexto: String(p.contexto || '').trim(),
        capitalInicial: cap,
        spyPrecioInicial: p.spyPrecioInicial ? Number(p.spyPrecioInicial) : null,
        tsCompra: Number(p.tsCompra || 0),
        portafolioId: p.portafolioId || null,
        objetivoPesos: p.objetivoPesos.map((obj) => ({
          sym: obj.sym,
          nombre: obj.nombre || MAPA_ACTIVOS[obj.sym]?.nombre || obj.sym,
          clase: obj.clase || MAPA_ACTIVOS[obj.sym]?.clase || 'STOCK',
          peso: Number(obj.peso || 0),
          montoUSD:
            Number(obj.montoUSD || 0) > 0
              ? Number(obj.montoUSD)
              : cap * Number(obj.peso || 0),
          precioCompra: Number(obj.precioCompra || 0),
          cantComprada: Number(obj.cantComprada || 0),
        })),
      };
    })
    .sort((a, b) => a.numero - b.numero || a.tsCompra - b.tsCompra);
}

/**
 * Siguiente número consecutivo (`1`, `2`, `3`...) para nombrar el próximo portafolio invertido.
 */
export function obtenerSiguienteNumeroPortafolio(perfil) {
  const lista = normalizarPortafoliosInvertidos(perfil);
  if (lista.length === 0) return 1;
  return lista.reduce((maxN, p) => Math.max(maxN, Number(p.numero || 0)), 0) + 1;
}

/**
 * Devuelve un mapa `{ [sym]: 'Portafolio 1' | 'Portafolio 1 · 2' }` para etiquetar posiciones Spot.
 */
export function obtenerMapaEtiquetasPortafolioPorSym(perfil) {
  const lista = normalizarPortafoliosInvertidos(perfil);
  const numsPorSym = {};
  lista.forEach((p) => {
    p.objetivoPesos.forEach((item) => {
      if (!item?.sym) return;
      if (!numsPorSym[item.sym]) numsPorSym[item.sym] = new Set();
      numsPorSym[item.sym].add(p.numero);
    });
  });
  const etiquetas = {};
  Object.entries(numsPorSym).forEach(([sym, setNums]) => {
    const nums = Array.from(setNums).sort((a, b) => a - b);
    etiquetas[sym] =
      nums.length === 1 ? `Portafolio ${nums[0]}` : `Portafolio ${nums.join(' · ')}`;
  });
  return etiquetas;
}

/**
 * Calcula seguimiento en vivo por cada portafolio individual (Portafolio 1, Portafolio 2, ...)
 * y la combinación total ponderada de pesos y capital entre todos los portafolios invertidos.
 */
export function calcularSeguimientoPortafolios(
  portafolios = [],
  posicionesSpot = {},
  precios = {}
) {
  if (!Array.isArray(portafolios) || portafolios.length === 0) {
    return {
      portafolios: [],
      combinado: null,
    };
  }

  // Cantidad total registrada en los portafolios por símbolo (para detectar ventas parciales o cierres en Mercado)
  const cantRegistradaPorSym = {};
  portafolios.forEach((p) => {
    p.objetivoPesos.forEach((obj) => {
      const posSpot = posicionesSpot?.[obj.sym];
      const cot = precios?.[obj.sym];
      const pxRef =
        Number(obj.precioCompra || 0) ||
        Number(posSpot?.costo || 0) ||
        (cot?.disponible && Number(cot.p) > 0 ? Number(cot.p) : 0);
      const cantEst =
        Number(obj.cantComprada || 0) > 0
          ? Number(obj.cantComprada)
          : pxRef > 0
            ? Number(obj.montoUSD || 0) / pxRef
            : 0;
      cantRegistradaPorSym[obj.sym] = (cantRegistradaPorSym[obj.sym] || 0) + cantEst;
    });
  });

  const detallePortafolios = portafolios.map((p) => {
    let valorActual = 0;
    let costoActivo = 0;
    let invertidoTotal = 0;
    let sumaPesosObjetivoPct = 0;
    let activosAbiertos = 0;

    const filasRaw = p.objetivoPesos.map((obj) => {
      const posSpot = posicionesSpot?.[obj.sym];
      const cot = precios?.[obj.sym];
      const cantSpotCuenta = Number(posSpot?.cant || 0);
      const costoSpotCuenta = Number(posSpot?.costo || 0);
      const pxVivo =
        cot?.disponible && Number(cot.p) > 0
          ? Number(cot.p)
          : costoSpotCuenta || Number(obj.precioCompra || 0);
      const precioCompra =
        Number(obj.precioCompra || 0) || costoSpotCuenta || pxVivo || 0;
      const montoUSD = Number(obj.montoUSD || 0);
      const cantNominal =
        Number(obj.cantComprada || 0) > 0
          ? Number(obj.cantComprada)
          : precioCompra > 0
            ? montoUSD / precioCompra
            : 0;

      const regTotal = cantRegistradaPorSym[obj.sym] || 0;
      const cerradaManual = cantSpotCuenta <= 1e-8;
      let cantActiva = 0;
      if (!cerradaManual && cantNominal > 0) {
        if (regTotal > 0 && cantSpotCuenta < regTotal * 0.999) {
          cantActiva = cantNominal * (cantSpotCuenta / regTotal);
        } else {
          cantActiva = cantNominal;
        }
      }

      if (!cerradaManual && cantActiva > 1e-8) activosAbiertos += 1;

      const valActualFila = cantActiva * pxVivo;
      const costoFila = cerradaManual ? 0 : cantActiva * precioCompra;
      const pnlUSD = cerradaManual ? 0 : valActualFila - costoFila;
      const pnlPct = costoFila > 0 ? (pnlUSD / costoFila) * 100 : 0;
      const pesoObjetivoPct = Number(obj.peso || 0) * 100;

      valorActual += valActualFila;
      costoActivo += costoFila;
      invertidoTotal += montoUSD;
      sumaPesosObjetivoPct += pesoObjetivoPct;

      return {
        sym: obj.sym,
        symCorto: String(obj.sym || '').replace('_USDT', ''),
        nombre: obj.nombre || MAPA_ACTIVOS[obj.sym]?.nombre || obj.sym,
        clase: obj.clase || MAPA_ACTIVOS[obj.sym]?.clase || 'STOCK',
        pesoObjetivoPct,
        montoUSD,
        precioCompra,
        precioVivo: pxVivo,
        cantComprada: cantNominal,
        cantActiva,
        valorActual: valActualFila,
        costoActivo: costoFila,
        pnlUSD,
        pnlPct,
        cerradaManual,
      };
    });

    const filas = filasRaw.map((f) => ({
      ...f,
      pesoActualPct: valorActual > 0 ? (f.valorActual / valorActual) * 100 : 0,
    }));

    const capitalBase = invertidoTotal > 0 ? invertidoTotal : p.capitalInicial;
    const pnlUSD = valorActual - costoActivo;
    const pnlPct = costoActivo > 0 ? (pnlUSD / costoActivo) * 100 : 0;

    return {
      ...p,
      capitalBase,
      valorActual,
      costoTotal: costoActivo,
      pnlUSD,
      pnlPct,
      sumaPesosObjetivoPct,
      activosAbiertos,
      activosTotal: filas.length,
      filas,
    };
  });

  // Agregación combinada de pesos y montos de TODOS los portafolios guardados
  const mapaActivos = new Map();
  let totalCapitalCombinado = 0;
  let totalValorActualCombinado = 0;
  let totalCostoActivoCombinado = 0;

  detallePortafolios.forEach((p) => {
    totalCapitalCombinado += p.capitalBase;
    totalValorActualCombinado += p.valorActual;
    totalCostoActivoCombinado += p.costoTotal;

    p.filas.forEach((f) => {
      if (!mapaActivos.has(f.sym)) {
        mapaActivos.set(f.sym, {
          sym: f.sym,
          symCorto: f.symCorto,
          nombre: f.nombre,
          clase: f.clase,
          montoTotalUSD: 0,
          valorActualTotal: 0,
          costoActivoTotal: 0,
          cantTotalPortafolios: 0,
          precioVivo: f.precioVivo,
          abiertoEnCuenta: !f.cerradaManual,
          desglosePortafolios: [],
        });
      }
      const acc = mapaActivos.get(f.sym);
      acc.montoTotalUSD += f.montoUSD;
      acc.valorActualTotal += f.valorActual;
      acc.costoActivoTotal += f.costoActivo;
      acc.cantTotalPortafolios += f.cantActiva;
      if (f.precioVivo > 0) acc.precioVivo = f.precioVivo;
      if (!f.cerradaManual) acc.abiertoEnCuenta = true;
      acc.desglosePortafolios.push({
        id: p.id,
        numero: p.numero,
        alias: p.alias,
        pesoEnPortafolioPct: f.pesoObjetivoPct,
        montoUSD: f.montoUSD,
        cerradaManual: f.cerradaManual,
      });
    });
  });

  const activosCombinados = Array.from(mapaActivos.values())
    .sort((a, b) => b.montoTotalUSD - a.montoTotalUSD)
    .map((item, idx) => {
      const pesoCombinadoPct =
        totalCapitalCombinado > 0 ? (item.montoTotalUSD / totalCapitalCombinado) * 100 : 0;
      const pesoActualCombinadoPct =
        totalValorActualCombinado > 0
          ? (item.valorActualTotal / totalValorActualCombinado) * 100
          : 0;
      const pnlUSD = item.valorActualTotal - item.costoActivoTotal;
      const pnlPct =
        item.costoActivoTotal > 0 ? (pnlUSD / item.costoActivoTotal) * 100 : 0;
      const cantSpotCuenta = Number(posicionesSpot?.[item.sym]?.cant || 0);
      return {
        ...item,
        color: COLORES_PORTAFOLIO[idx % COLORES_PORTAFOLIO.length],
        pesoCombinadoPct,
        pesoActualCombinadoPct,
        pnlUSD,
        pnlPct,
        cantSpotCuenta,
        cerradaManual: cantSpotCuenta <= 1e-8,
        desglosePortafolios: item.desglosePortafolios.map((d) => ({
          ...d,
          aportePesoGlobalPct:
            totalCapitalCombinado > 0 ? (d.montoUSD / totalCapitalCombinado) * 100 : 0,
        })),
      };
    });

  const sumaPesosCombinadosPct = activosCombinados.reduce(
    (acc, a) => acc + a.pesoCombinadoPct,
    0
  );
  const sumaPesosActualesPct = activosCombinados.reduce(
    (acc, a) => acc + a.pesoActualCombinadoPct,
    0
  );
  const totalPnlCombinadoUSD = totalValorActualCombinado - totalCostoActivoCombinado;
  const totalPnlCombinadoPct =
    totalCostoActivoCombinado > 0
      ? (totalPnlCombinadoUSD / totalCostoActivoCombinado) * 100
      : 0;

  return {
    portafolios: detallePortafolios,
    combinado: {
      cantidadPortafolios: detallePortafolios.length,
      totalCapitalCombinado,
      totalValorActualCombinado,
      totalCostoActivoCombinado,
      totalPnlCombinadoUSD,
      totalPnlCombinadoPct,
      sumaPesosCombinadosPct,
      sumaPesosActualesPct,
      activosCombinados,
    },
  };
}
