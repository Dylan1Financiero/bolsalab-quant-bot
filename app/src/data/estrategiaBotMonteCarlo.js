// Datos de la versión final del bot: Bollinger + EMA 200 sin filtro de entrada RF (133 operaciones en XRP, 1m)
// Del 9 al 15 de noviembre de 2026 · TP 2.0 ATR / SL 0.4 ATR · Saldo simulado 1,000 USDT

export const BOT_ESTRATEGIA_DATA = {
  n: 133,
  wr: 24.81203007518797,
  pf: 2.25,
  neto: 69.54,
  win: 3.79,
  loss: -0.56,
  ganadas: 33,
  icLow: 1.36,
  icHigh: 3.38,
  eq: [
    -0.72, 2.02, 1.38, 3.57, 3.21, 6.21, 5.66, 5.2, 7.12, 6.75, 6.01, 5.55, 5.09, 4.63, 4.17, 3.8,
    3.34, 8.87, 17.42, 16.37, 15.61, 20.49, 19.82, 19.35, 18.97, 18.5, 18.03, 17.65, 17.18, 16.47,
    15.9, 15.33, 14.95, 14.57, 14.29, 14.01, 13.63, 13.25, 12.78, 12.31, 11.93, 11.46, 14.73, 14.17,
    13.7, 16.33, 18.88, 18.5, 20.29, 22.46, 22.08, 21.7, 21.03, 20.36, 19.98, 22.16, 24.16, 26.08,
    25.79, 25.41, 25.03, 28.6, 34.03, 33.44, 36.27, 35.69, 35.3, 37.54, 37.15, 36.77, 36.38, 38.02,
    37.23, 36.84, 36.45, 36.06, 35.67, 35.08, 34.79, 40.91, 40.04, 44.44, 43.85, 43.26, 42.57, 45.51,
    47.37, 47.08, 46.79, 46.5, 45.81, 45.31, 45.01, 44.61, 44.21, 43.91, 45.79, 44.79, 43.99, 43.4,
    42.77, 42.15, 41.66, 41.35, 40.74, 40.12, 39.52, 44.42, 48.62, 55.56, 53.32, 56.57, 60.08, 65.27,
    77.6, 76.65, 75.64, 74.2, 73.52, 72.67, 71.94, 71.09, 70.05, 69.18, 68.34, 67.69, 67.33, 66.87,
    66.11, 70.75, 70.39, 70.01, 69.54,
  ],
  sym: Array(133).fill('XRP'),
  // Comparativa verificada por criptomoneda (Diapositiva 10): Bollinger a favor vs en contra de la EMA 200
  por: [
    { sym: 'XRP', nombre: 'XRP', pf: 1.67, pfContra: 1.02 },
    { sym: 'ETH', nombre: 'Ethereum', pf: 1.31, pfContra: 0.87 },
    { sym: 'SOL', nombre: 'Solana', pf: 1.24, pfContra: 1.11 },
    { sym: 'BTC', nombre: 'Bitcoin', pf: 1.11, pfContra: 0.88 },
  ],
  resumen4Criptos: {
    sinFiltro: { ops: 491, pf: 1.64 },
    conFiltroEstricto: { ops: 229, pf: 2.0 },
  },
  heat: [
    [1.25, 1.17, 1.06, 1.05, 1.19, 1.09, 1.1],
    [1.63, 1.44, 1.27, 1.29, 1.4, 1.26, 1.3],
    [1.74, 1.49, 1.3, 1.2, 1.22, 1.05, 1.08],
    [2.08, 1.75, 1.54, 1.35, 1.37, 1.17, 1.21],
    [2.5, 2.0, 1.74, 1.47, 1.37, 1.15, 1.21],
    [2.17, 1.79, 1.55, 1.35, 1.32, 1.11, 1.02],
  ],
  wrh: [
    [36, 47, 50, 61, 69, 74, 79],
    [32, 41, 45, 55, 63, 69, 75],
    [28, 35, 38, 46, 53, 59, 65],
    [24, 30, 33, 39, 46, 53, 59],
    [21, 26, 28, 34, 39, 46, 52],
    [13, 17, 18, 23, 28, 34, 39],
  ],
  tps: [0.5, 0.75, 1.0, 1.5, 2.0, 3.0],
  sls: [0.25, 0.4, 0.5, 0.75, 1.0, 1.5, 2.0],
};

export const JOURNEY_DATA = [
  { n: '1. Código original', s: 'Acertaba 46 de cada 100', v: 0.95, t: '<b>Código original</b><br>Ganaba 0.95 por cada dólar perdido: perdía poco a poco.' },
  { n: '2. Win rate alto', s: 'Acertaba 90 de cada 100', v: 0.87, t: '<b>Win rate alto</b><br>Acertaba casi siempre, pero cada error borraba diez aciertos.' },
  { n: '3. RSI con tendencia', s: 'Acertaba 47 de cada 100', v: 1.1, t: '<b>RSI con tendencia</b><br>Primera versión que ganó: 1.10 por cada dólar perdido.' },
  { n: '4. Bollinger con tendencia', s: 'TP 1.5 / SL 0.5 ATR', v: 1.54, t: '<b>Bollinger con tendencia</b><br>Ganancia a 1.5 y pérdida a 0.5 veces el movimiento normal.' },
  { n: '5. Con filtro estricto', s: 'TP 2.0 / SL 0.4 ATR, 4 criptos', v: 2.0, t: '<b>Con filtro estricto (229 ops)</b><br>Más selectivo, pero pasaba hasta 15 horas sin operar.' },
  { n: '6. Versión final, sin filtro', s: 'TP 2.0 / SL 0.4 ATR, XRP', v: 2.25, hi: true, t: '<b>Versión final, sin filtro (133 ops)</b><br>Opera el doble (22/día) con PF 2.25 y +70 USDT neto en XRP.' },
];

export const STRATS_DATA = [
  { n: 'Bollinger con tendencia', s: 'La elegida', v: 1.67, hi: true },
  { n: 'Cruce de medias 50/200', s: 'Muy pocas señales', v: 1.44 },
  { n: 'Bollinger sin tendencia', s: 'Sin filtro EMA 200', v: 1.17 },
  { n: 'RSI', s: 'Sobrecompra y sobreventa', v: 1.13 },
  { n: 'Chartismo', s: 'Figuras y rupturas', v: 0.99 },
  { n: 'Fibonacci', s: 'Retrocesos', v: 0.98 },
  { n: 'SuperTrend', s: 'Cambios de dirección', v: 0.75 },
];

export const FILTRO_RF_COMPARATIVA = [
  { modo: 'Estricto: exige confirmación', ops: 58, porDia: 9, wr: '32.8%', pf: '3.53', neto: '+$59', nota: 'Pasaba hasta 15 h sin operar', best: false },
  { modo: 'Veto: solo bloquea lo contrario', ops: 97, porDia: 16, wr: '28.9%', pf: '2.63', neto: '+$64', nota: 'Bloquea si RF predice lado opuesto', best: false },
  { modo: 'Sin filtro (versión final) ★', ops: 133, porDia: 22, wr: '24.8%', pf: '2.25', neto: '+$70', nota: 'RF solo ajusta apalancamiento x15 en XRP', best: true },
];

export const GLOSARIO_ESTRATEGIA = [
  ['Profit factor', 'Cuánto se gana por cada dólar que se pierde. Arriba de 1 se gana; meta del curso: > 1.2.'],
  ['Win rate', 'De cada 100 operaciones, cuántas terminan en ganancia (equilibrio en 16.7% con 5:1).'],
  ['Bandas de Bollinger', 'Un canal alrededor del precio (20, 2σ). Si el precio se sale y regresa, hay señal.'],
  ['Tendencia (EMA 200)', 'El promedio de los últimos 200 minutos. Si el precio está arriba, solo compra; abajo, solo vende.'],
  ['Take Profit (2.0 ATR)', 'El precio donde el bot cierra con ganancia (cinco veces la distancia del Stop Loss).'],
  ['Stop Loss (0.4 ATR)', 'El precio donde el bot corta la pérdida para mantenerla pequeña.'],
];
