# BolsaLab — Rediseño "Terminal de trading profesional"

Objetivo: que BolsaLab se vea y se use como la plataforma de una casa de bolsa internacional (densidad de
información, gráfica al centro, libro de órdenes, colores sobrios). **Inspirado** en las convenciones de
terminales como TradingView o Binance, **sin copiar** su marca: nada de sus logos, nombres, íconos propios,
textos ni capturas. Todo debe ser diseño propio de BolsaLab.

Reglas de trabajo:
- No modificar nada dentro de `bot/` ni los nombres de colecciones/campos de Firestore.
- Solo cambia la capa visual y la distribución; la lógica que ya funciona se conserva.
- Hacerlo por fases (abajo) y compilar al terminar cada una.

---

## 1. Sistema de diseño (tokens)

Archivo único `src/styles/tokens.css`; ningún color o tamaño "a mano" en los componentes.

```css
:root {
  /* Fondos (de más oscuro a más claro) */
  --bg-app:      #0B0E13;   /* fondo general */
  --bg-panel:    #12161D;   /* paneles */
  --bg-panel-2:  #181D26;   /* encabezados de panel, filas hover */
  --bg-input:    #1C222C;
  --border:      #232A35;   /* líneas de 1px entre paneles */
  --border-strong:#2E3746;

  /* Texto */
  --text-1: #E6EAF0;        /* principal */
  --text-2: #9AA4B2;        /* secundario / etiquetas */
  --text-3: #5F6B7A;        /* deshabilitado / ejes */

  /* Mercado */
  --up:     #16C784;        /* sube / compra / LONG */
  --up-bg:  rgba(22,199,132,.12);
  --down:   #EA3943;        /* baja / venta / SHORT */
  --down-bg:rgba(234,57,67,.12);

  /* Marca BolsaLab (acento único, para botones primarios, selección y foco) */
  --accent:    #3B82F6;
  --accent-bg: rgba(59,130,246,.14);
  --warning:   #F0B90B;     /* avisos, riesgo medio */

  /* Tipografía */
  --font-ui:   'Inter', system-ui, sans-serif;
  --font-num:  'JetBrains Mono', 'IBM Plex Mono', monospace;   /* TODOS los números */
  --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 15px; --fs-xl: 20px; --fs-xxl: 28px;

  /* Espaciado y forma */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px;
  --radius-sm: 4px; --radius: 6px;          /* esquinas poco redondeadas, look profesional */
  --row-h: 28px;                             /* altura de fila en tablas densas */
  --t-fast: 120ms ease-out;
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
```

Reglas:
- **Números siempre en `--font-num`** con `font-variant-numeric: tabular-nums` y alineados a la derecha.
- Verde y rojo **solo** para dirección de precio o resultado (sube/baja, ganancia/pérdida, LONG/SHORT).
  El morado actual desaparece; el acento es azul.
- Sin gradientes de colores, sin sombras grandes, sin glassmorphism. Paneles planos separados por bordes de 1px.
- Sin emojis como íconos: usar `lucide-react` (un solo tamaño: 16px en barras, 14px en tablas).
- Contraste mínimo 4.5:1 para texto (`--text-2` sobre `--bg-panel` cumple).
- Al cambiar un precio, la celda parpadea 300 ms con `--up-bg` o `--down-bg` (si no hay reduced-motion).

## 2. Estructura general (layout tipo terminal)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Barra superior (48px): logo BolsaLab | menú | buscador de activo (Ctrl+K) |    │
│ estado del bot (● En línea / ● Desconectado) | Patrimonio | P&L hoy | usuario  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Cinta de precios (28px): BTC 67,346 −0.8% · ETH … · NVDA … (scroll continuo)    │
├───────────┬──────────────────────────────────────────────┬───────────────────┤
│ Lista de  │ Encabezado del activo: BTC/USDT  67,346.12    │ Boleta de orden   │
│ mercado   │ +1.2%  Máx 24h  Mín 24h  Volumen              │ (Comprar|Vender)  │
│ (260px)   ├──────────────────────────────────────────────┤ Tipo: Mercado/    │
│ buscador, │ Barra de herramientas del gráfico:            │ Límite, monto,    │
│ pestañas  │ 1m 5m 15m 1h 4h 1D | velas/línea | indicadores │ % de saldo,       │
│ Cripto/   │ | herramientas de dibujo | pantalla completa   │ apalancamiento,   │
│ Acciones/ ├──────────────────────────────────────────────┤ SL/TP, resumen    │
│ ETFs,     │                                              │ y botón grande    │
│ favoritos │            GRÁFICA (ocupa lo máximo)          │ verde o rojo      │
│ ★         │                                              ├───────────────────┤
│           │                                              │ Análisis del bot  │
│           │                                              │ (señal, riesgo,   │
│           │                                              │ resumen)          │
├───────────┴──────────────────────────────────────────────┴───────────────────┤
│ Panel inferior con pestañas (alto ajustable arrastrando, 240px por defecto):  │
│ Posiciones abiertas (n) | Órdenes | Historial | Cerradas hoy | Cuenta del bot  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Pantalla completa sin márgenes externos; paneles pegados con bordes de 1px (`--border`).
- En < 1024px: la lista de mercado se vuelve un cajón lateral y la boleta pasa abajo de la gráfica.
- En < 640px: pestañas inferiores fijas (Mercado | Gráfica | Operar | Posiciones | Más).

## 3. Componentes

**Barra superior.** Altura 48px. Menú horizontal: Mercados · Trading (bot) · Portafolio · Aprender (juego) ·
Modelo ML · Analista IA. Indicador del bot: punto verde "Bot en línea" si `bot/estado.ts` < 60 s, rojo
"Bot desconectado" si no. Patrimonio y P&L del día en `--font-num`.

**Lista de mercado.** Columnas: ★ | Símbolo (y nombre pequeño debajo) | Último | Var. 24h. Filas de 28px,
hover `--bg-panel-2`, activo seleccionado con barra izquierda de 2px `--accent`. Var. 24h en verde/rojo.
Buscador arriba; pestañas Cripto / Acciones / ETFs / ★ Favoritos (guardados en el usuario).

**Encabezado del activo.** Símbolo grande, precio `--fs-xxl` coloreado según la última variación,
debajo en `--fs-sm`: Var. 24h, Máximo, Mínimo, Volumen, Temporalidad del bot.

**Gráfica (lightweight-charts, no el widget).**
- Fondo `--bg-panel`, cuadrícula `#1A202A`, ejes `--text-3`, velas `--up`/`--down` sin borde, volumen
  abajo al 20% de alto con opacidad .35, cruz (crosshair) con etiquetas de precio y hora.
- Línea punteada del precio actual con etiqueta a la derecha.
- Barra de herramientas: temporalidades (envían el comando `tf` del bot cuando es la gráfica del bot),
  tipo de gráfica, Indicadores (EMA, Bollinger, RSI, SuperTrend: los que publica `bot/analisis`),
  **herramientas de dibujo propias**: línea de tendencia, horizontal, rectángulo, Fibonacci (2 clics),
  borrar; los dibujos del usuario se guardan por activo en `usuarios/{uid}/dibujos/{activo}`.
- Capa "Análisis del bot" (lo de la sección 5.4 ter) con interruptor para mostrar u ocultar.
- Leyenda arriba a la izquierda: O H L C y % de la vela bajo el cursor, en `--font-num`.

**Boleta de orden.** Pestañas Comprar (verde) / Vender (rojo). Campos: tipo (Mercado | Límite), precio
(deshabilitado en Mercado), monto en USD con deslizador 0/25/50/75/100% del saldo, apalancamiento (1x/5x/10x),
SL y TP opcionales. Resumen antes del botón: tamaño de la posición, margen, precio de liquidación estimado.
Botón de ancho completo "Comprar BTC" / "Vender BTC". Confirmación con el modal que ya existe.

**Panel inferior (tablas densas).** Encabezados `--fs-xs` en mayúsculas `--text-2`, filas de 28px,
números a la derecha. Posiciones abiertas: Activo | Lado | Tamaño | Entrada | Precio marca | Liquidación |
Margen | P&L (y %) | SL/TP | [Cerrar]. El botón Cerrar de cada fila abre el modal con la ganancia/pérdida.
Contador en la pestaña: "Posiciones abiertas (2)".

**Tarjetas de métricas (Portafolio, Modelo ML).** Etiqueta arriba en `--fs-xs` `--text-2`, valor abajo en
`--fs-xl` `--font-num`. Una métrica por fila o en cuadrícula; nunca etiqueta y valor pegados.

**Estados.** Carga con esqueletos grises (no spinners grandes). Vacío con texto corto y una acción
("No tienes posiciones abiertas · Abrir una orden"). Errores en una sola barra superior roja con el mensaje
en español, sin repetir el mismo aviso varias veces.

## 4. Fases

1. Tokens + tipografía + barra superior + cinta de precios. Reemplazar morado por el acento azul.
2. Pestaña Mercado con el layout de 3 columnas + panel inferior con pestañas.
3. Pestaña Trading (bot): misma estructura; la columna derecha muestra el panel del bot (Telegram) y
   el análisis; el panel inferior trae Posiciones, Operaciones del bot y Cuenta del bot.
4. Herramientas de dibujo en la gráfica (también se reutilizan en el juego).
5. Portafolio, Modelo ML, Aprender y Analista IA con los mismos tokens, tarjetas y tablas.
6. Responsivo (375, 768, 1024, 1440 px) y revisión de accesibilidad (foco visible, `cursor-pointer`,
   contraste, navegación con teclado).

## 5. Lista de verificación final (OK/FALLA con captura a 1440px y a 390px)

- [ ] Sin colores ni tamaños fuera de `tokens.css`; sin morado; sin gradientes; sin emojis como íconos.
- [ ] Todos los números en fuente monoespaciada y alineados a la derecha.
- [ ] Verde/rojo solo para dirección de precio y resultados.
- [ ] Gráfica ocupa al menos 55% del ancho en 1440px.
- [ ] Indicador "Bot en línea / desconectado" correcto.
- [ ] Lista de mercado, boleta y panel inferior funcionando con los datos actuales.
- [ ] Dibujo de líneas en la gráfica y persistencia por activo.
- [ ] Nada dentro de `bot/` modificado.
