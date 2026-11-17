# Informe de Auditoría Técnica v2 — BolsaLab

**Fecha de auditoría:** 2026-11-15  
**Objetivo:** Auditoría de solo lectura previo a la entrega del **17 de noviembre**, sin modificar `bot/` ni `app/`, sin cambiar nombres de Firestore, sin enviar comandos de control (`toggle`, `activo`, `tf`, `estrategia`, `long`, `short`, `cerrar`) al bot real, y utilizando únicamente un usuario temporal de prueba (`oKnXkq9iYLZLpwrEfzX7fh1xoPm1`, eliminado junto con sus documentos al concluir).

---

## Resumen ejecutivo

| Área | Estado | Nota clave |
|---|---|---|
| 1. URL pública (`bolsalab-udem.web.app`) | `FALTA` | Devuelve `HTTP/2 404` (`Site Not Found`); `firebase.json` en raíz solo define `firestore` y no `hosting`. |
| 2. Gráfica del bot (`Trading bot`) | `OK` | Chartismo, pivotes/gatillos, limpieza al cambiar a `EMA50_200` y cajas TP/SL (`SHORT` con `TP ↓` abajo y `SL ↑` arriba) verificados; durante la captura viva `bot/estado.position` estaba `null` tras cerrar un `SHORT` por TP. |
| 3. Operaciones del bot | `PARCIAL` | Existe la tabla con 12 filas recientes, pero faltan hora de apertura, duración, explicación en español, filtros y botón Exportar CSV. |
| 4. Métricas honestas (Resultados / Win rate) | `FALTA` | No existe bloque en UI ni nota `"Resultados sin comisiones"` en Resultados/Win rate. Sobre 40 trades: Win rate real `45.0%`, equilibrio `66.0%`, PF `0.44`, PnL total `-$124.65` (`+$26.51` excluyendo cierres manuales). |
| 5. Estado del bot | `PARCIAL` | No hay dos bots chocando (`instancia: "4b019810"` estable), pero `bot/estado` no reporta origen (`VM` vs `Spyder`); `BotView.jsx` hardcodea `Spyder` y otros 3 archivos de la app aún dicen `VM`. |
| 6. Portafolio — Opción 2 (ML regresión) | `PARCIAL` | En tabla real de la UI, `MAPE` y `SMAPE` salen como `—` y `Variance Score` usa `r2` (o `0.000` en base) porque el bot en `bot_quant_x10_app.py` no escribe `mape`, `smape` ni `variance_score`. |
| 7. Pendientes del informe anterior | `PARCIAL` | 2 `OK` (`botAutoCopiar` en Ajustes, etiquetas `"hoy"`/`"24h"` + chip `"Mercado cerrado"`), 3 `FALTA` (ruta UI a `MisPosicionesView`, suscripciones sin uso `winrateDoc`/`dmDoc`, usuarios de prueba en `ranking`). |
| 8. Seguridad (`git ls-files`) | `FALTA` | `.env` y `firebase-credenciales.json` NO están rastreados, pero `bot/bot_quant_x10_app.py` sí está rastreado y contiene 7 credenciales con valor por defecto largo en `os.getenv(...)`. |
| 9. Consola y permisos (6 pestañas) | `OK` | `0` errores de consola JS y `0` errores de permisos (`Missing or insufficient permissions`) en el recorrido completo con usuario de prueba. |

---

## 1. URL Pública (`https://bolsalab-udem.web.app`)

| Punto | Estado | Evidencia | Archivo |
|---|---|---|---|
| Respuesta HTTP y carga del login en `https://bolsalab-udem.web.app` | `FALTA` | `curl -sS -i -L --max-time 15 https://bolsalab-udem.web.app` devolvió **`HTTP/2 404`** con HTML `<title>Site Not Found</title>`. El login no carga en la URL pública. | `firebase.json` (raíz) |
| Configuración de Firebase Hosting | `FALTA` | El `firebase.json` de la raíz del repositorio **no incluye bloque `hosting`** (solo apunta a `firestore.rules`). En contraste, `app/firebase.json` sí define `hosting` con `"public": "dist"` y rewrite SPA `** -> /index.html`, por lo que o falta desplegar desde `app/` o unificar `hosting` en la raíz. | [`firebase.json`](file:///Users/macintoshhd/Downloads/kit_antigravity/firebase.json), [`app/firebase.json`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/firebase.json#L1-L19) |

**Contenido exacto de `/Users/macintoshhd/Downloads/kit_antigravity/firebase.json` (raíz):**

```json
{"firestore":{"rules":"firestore.rules"}}
```

**Contenido relevante de `/Users/macintoshhd/Downloads/kit_antigravity/app/firebase.json` (líneas 1–19):**

```json
{
  "hosting": {
    "public": "dist",
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

*(Nota: en `app/firebase.json` también existe configuración de `firestore`, pero la raíz usa únicamente el `firebase.json` de una línea mostrado arriba).*

---

## 2. Gráfica del Bot (`Trading (bot)`)

> **Nota sobre la captura viva:** Al abrir la app durante esta auditoría (`v2_chart_2ab_live_short.png`), `bot/estado.position` era `null` porque el último `SHORT` del bot (`BTC/USDT 64,898.60 → 64,875.85`, `TAKE PROFIT +$0.35`) acababa de cerrarse a las `15:22`. Siguiendo la regla estricta de no enviar `long`/`short`/`toggle` al bot real, no se forzó apertura de orden; los puntos 2a y 2b se validaron contra el código vigente y la evidencia visual de los commits actuales (`28ce190` / `019254c`), y los puntos 2c y 2d se verificaron en pantalla en esta corrida.

| Criterio | Estado | Evidencia | Archivo |
|---|---|---|---|
| **a)** Cajas TP (verde) y SL (roja) coinciden con `bot/estado.position.tp` y `.sl` | `OK` | `BotCandlesChart.jsx` toma directamente `position.entry`, `position.tp` y `position.sl` para invocar `PositionRangePrimitive`. Verificado en capturas con posición abierta (`short_1_open_toast_and_boxes.png` y `chart_2_posicion_abierta.png`). En esta corrida viva, `bot/estado.position` estuvo en `null` (`v2_chart_2ab_live_short.png`). | [`BotCandlesChart.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotCandlesChart.jsx#L479-L521), [`PositionRangePrimitive.js`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/chart/PositionRangePrimitive.js#L219-L234) |
| **b)** En un `SHORT`, el TP queda abajo y el SL arriba | `OK` | `PositionRangePrimitive.js` invierte los límites según `side === 'SHORT'`, renderizando `TP ↓` en la caja verde inferior y `SL ↑` en la caja roja superior (verificado visualmente en `short_1_open_toast_and_boxes.png`). | [`PositionRangePrimitive.js`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/chart/PositionRangePrimitive.js#L52-L120), [`PositionRangePrimitive.js`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/chart/PositionRangePrimitive.js#L219-L231) |
| **c)** Al cambiar de estrategia se borran las líneas viejas y quedan las cajas | `OK` | Al cambiar la estrategia mostrada de `CHARTISMO` a `EMA50_200` (`v2_chart_2c_ema_wipe.png`), se eliminaron limpiamente las líneas de tendencia, pivotes H/L y niveles gatillo sin dejar líneas fantasma; con posición abierta, las cajas TP/SL permanecen visibles (`chart_4_ema_estrategia.png`). | [`BotCandlesChart.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotCandlesChart.jsx#L479-L521) |
| **d)** Con `Chartismo` se dibujan líneas, pivotes y gatillos | `OK` | Captura `v2_chart_2d_chartismo.png` confirma en pantalla las líneas de tendencia (`lineas[]`), marcadores de pivote `H` / `L` (`marcadores[]`) y líneas horizontales punteadas de gatillo/objetivo (`niveles[]`), más el resumen debajo de la gráfica. | [`BotCandlesChart.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotCandlesChart.jsx) |

**Evidencias visuales:**
- Gráfica en vivo (`bot/estado.position = null` tras cierre `SHORT` por TP): `v2_chart_2ab_live_short.png`
- Chartismo completo (líneas + pivotes `H`/`L` + gatillos): `v2_chart_2d_chartismo.png`
- Cambio a `EMA50_200` sin líneas fantasma: `v2_chart_2c_ema_wipe.png`
- Caja `SHORT` con TP abajo y SL arriba (verificación previa en el código actual): `short_1_open_toast_and_boxes.png`

---

## 3. Operaciones del Bot (`BotView` → pestaña `Operaciones del bot`)

| Requisito | Estado | Evidencia | Archivo |
|---|---|---|---|
| Tabla con operaciones del bot (≥10 filas) | `OK` | La pestaña `Operaciones del bot` renderiza `trades.slice(0, 12)` (`12` filas visibles en `v2_operaciones_10rows.png`). Columnas actuales (9): `HORA`, `ACTIVO`, `LADO`, `ESTRATEGIA`, `ENTRADA`, `SALIDA`, `MOTIVO`, `CERRADO POR`, `P&L USDT`. | [`BotView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotView.jsx#L1249-L1303) |
| Hora/fecha de **apertura** y **cierre** | `FALTA` | La columna `HORA` muestra solo el timestamp de cierre (`tr.ts`). En Firestore, los documentos de `trades_bot` tienen las 10 llaves `['activo', 'entrada', 'estrategia', 'lado', 'motivo', 'pnl_usdt', 'roe_pct', 'salida', 'temporalidad', 'ts']`; **no guardan timestamp de apertura**. | [`BotView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotView.jsx#L1249-L1303) |
| **Duración** de cada operación | `FALTA` | No existe columna ni cálculo de duración (y falta el campo de apertura en `trades_bot` para calcularla en operaciones históricas). | [`BotView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotView.jsx#L1249-L1303) |
| **Explicación en español** | `FALTA` | Solo muestra valores crudos en `MOTIVO` (`TAKE PROFIT`, `STOP LOSS`, `Cierre desde la app web`, `Cierre Manual`) y una columna inferida `CERRADO POR`, sin texto explicativo en español de la señal de entrada/cierre. | [`BotView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotView.jsx#L1249-L1303) |
| **Filtros** en tabla | `FALTA` | Verificación en DOM: `hasFilter: false` (no hay selector por activo, lado, estrategia o motivo). | [`BotView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotView.jsx#L1249-L1303) |
| **Exportar CSV** | `FALTA` | Verificación en DOM: `hasCsv: false` en `Operaciones del bot`. (`CentroResultadosBot.jsx` tiene un botón `"Exportar Excel"` que solicita `.xlsx` al bot por comando, pero no hay exportación CSV en la tabla). | [`BotView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotView.jsx#L1249-L1303) |

**Evidencia en DOM (`TAB_OPERACIONES`) y captura:**
- `{"headers":["HORA","ACTIVO","LADO","ESTRATEGIA","ENTRADA","SALIDA","MOTIVO","CERRADO POR","P&L USDT"],"rows":12,"hasFilter":false,"hasCsv":false}`
- Captura: `v2_operaciones_10rows.png`

---

## 4. Métricas Honestas en Resultados / Win rate

| Elemento en UI | Estado | Evidencia | Archivo |
|---|---|---|---|
| Win rate real | `FALTA` | No existe panel calculado en `Resultados` (`CentroResultadosBot.jsx` solo muestra el espejo de mensajes de `telegram_espejo`). | [`CentroResultadosBot.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/CentroResultadosBot.jsx#L1-L140) |
| Win rate de equilibrio | `FALTA` | Verificación en DOM: `hasEquilibrio: false`. | [`CentroResultadosBot.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/CentroResultadosBot.jsx#L300-L418) |
| Profit factor | `FALTA` | Verificación en DOM: `hasProfitFactor: false`. | [`CentroResultadosBot.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/CentroResultadosBot.jsx#L300-L418) |
| PnL excluyendo cierres manuales | `FALTA` | Verificación en DOM: `hasSinManuales: false`. | [`CentroResultadosBot.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/CentroResultadosBot.jsx#L300-L418) |
| Nota `"Resultados sin comisiones"` en Resultados / Win rate | `FALTA` | Verificación en DOM: `hasSinComisiones: false` en `Resultados` / `CentroResultadosBot.jsx`. Esa leyenda solo existe en `MisPosicionesView.jsx`, `CerrarPosicionModal.jsx` y `tradingConfig.js`. | [`CentroResultadosBot.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/CentroResultadosBot.jsx#L300-L418), [`MisPosicionesView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/MisPosicionesView.jsx#L190) |

### Cálculo real sobre los **40 documentos** actuales de `trades_bot` en Firestore

| Métrica | Valor calculado (datos reales de `trades_bot`) | Detalle |
|---|---|---|
| Total de operaciones | **40** | `18` ganadas (`pnl_usdt > 0`), `21` perdidas (`pnl_usdt < 0`), `1` en punto de equilibrio (`0.00`) |
| Desglose por `motivo` | App web: `14` · TP: `12` · SL: `11` · Manual: `3` | Cierres manuales/web = `17` · Cierres automáticos del bot (TP/SL) = `23` |
| **Win rate real** | **45.0%** | `18 / 40` |
| Ganancia promedio / Pérdida promedio | **`$5.48` USDT** / **`$10.63` USDT** | Valores exactos: `5.4767` / `10.6300` |
| **Win rate de equilibrio** (`pérdida prom / (ganancia prom + pérdida prom)`) | **66.0%** | `10.63 / (5.4767 + 10.63) = 0.65997...` (el win rate real está **21.0 pp** por debajo del equilibrio) |
| **Profit factor** | **0.44** | `0.4416` |
| **PnL total (40 trades)** | **`-$124.65` USDT** | Suma neta con cierres manuales incluidos |
| PnL de cierres manuales (`17` trades) | **`-$151.16` USDT** | `14` `"Cierre desde la app web"` + `3` `"Cierre Manual"` |
| **PnL excluyendo cierres manuales (`23` trades TP/SL)** | **`+$26.51` USDT** | El rendimiento neto del bot con TP/SL automático sin intervención manual es positivo |

---

## 5. Estado del Bot y detección de doble instancia

| Aspecto | Estado | Evidencia | Archivo |
|---|---|---|---|
| Campo de origen (`VM` vs `Spyder`) en `bot/estado` | `FALTA` | Las llaves reales de `bot/estado` son `["asset", "asset_name", "balance", "clase", "instancia", "last_signal", "leverage", "position", "price", "realized_pnl", "risk", "signal_now", "signal_text", "strategy", "strategy_label", "timeframe", "trading_enabled", "ts", "uptime_min", "vm"]`. El campo `vm` **no indica si corre en VM o Spyder**: solo envía CPU y RAM de `psutil` (`{'cpu': 16, 'ram': 75}`). | [`bot_quant_x10_app.py`](file:///Users/macintoshhd/Downloads/kit_antigravity/bot/bot_quant_x10_app.py#L2778-L2799) |
| Coherencia de texto en la interfaz web | `PARCIAL` | `BotView.jsx` (tras el commit `c89d932`) muestra de forma fija `'Bot en línea · Spyder local'` / `'Python local en Spyder'`. Sin embargo, **`AnalistaIAView.jsx`**, **`usePreciosVivo.js`** y **`firebase.js`** todavía tienen cadenas heredadas que mencionan `"VM"`. | [`BotView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotView.jsx#L724-L738), [`usePreciosVivo.js`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/hooks/usePreciosVivo.js#L160), [`firebase.js`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/lib/firebase.js#L1085) |
| ¿Hay dos bots publicando a la vez (VM y Spyder)? | `OK` | Muestreo continuo de `bot/estado` (4 lecturas en 12 s + verificación a los 70 s): **una sola instancia** constante (`instancia: "4b019810"`) con `ts` avanzando monótonamente de `1794777724.669703` a `1794777788.089837`. No hay alternancia ni colisión de dos bots. | `bot/estado` (Firestore) |

---

## 6. Portafolio — Opción 2 (Validación ML de regresión)

Se ejecutó un cálculo real en vivo en **Portafolio** con el usuario de prueba (`portafolios/kzeJHo1mSEPPpJTPTnYc`, eliminado tras inspeccionar) y se revisó tanto la tabla renderizada (`v2_portafolio_opcion2.png`) como el documento guardado en Firestore.

| Aspecto | Estado | Evidencia | Archivo |
|---|---|---|---|
| Ejecución de Opción 2 y render de tabla ML | `OK` | El bot completó la corrida (`PORTAFOLIO_OP2_DONE: true`) y la UI mostró los 3 modelos + baseline `Ingenuo (promedio histórico)` con `RMSE`, `MSE`, `MAE`, `DIR. %`, `DM` y `P`. | [`PortafolioMLView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/PortafolioMLView.jsx#L1900-L2025) |
| Métricas `MAPE`, `SMAPE` y `Variance Score` reales en Opción 2 | `FALTA` | En la UI real (`v2_portafolio_opcion2.png`), **`MAPE` y `SMAPE` aparecen vacíos (`—`)** en las 4 filas, y **`VAR. SCORE`** muestra `r2` (o `0.000` fijo en el modelo ingenuo). Causa: `bot_quant_x10_app.py` solo escribe `rmse`, `mse`, `mae`, `r2`, `acierto_direccion`, `modelo`, `dm`, `p` en `modelos[]` y solo `modelo`, `rmse`, `mae` en `base`; **faltan `mape`, `smape` y `variance_score` en `bot_quant_x10_app.py`**. | [`bot_quant_x10_app.py`](file:///Users/macintoshhd/Downloads/kit_antigravity/bot/bot_quant_x10_app.py#L3906-L3917), [`PortafolioMLView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/PortafolioMLView.jsx#L1954), [`PortafolioMLView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/PortafolioMLView.jsx#L2005) |

**Valores exactos observados en pantalla (`v2_portafolio_opcion2.png`):**

| Modelo | RMSE | MSE | MAE | MAPE | SMAPE | VAR. SCORE | DIR. % | DM | P |
|---|---|---|---|---|---|---|---|---|---|
| `Random Forest` | `10.30` | `106.17` | `7.13` | **`—`** | **`—`** | `-0.112` *(fallback `r2`)* | `51.7%` | `+1.01` | `0.312` |
| `KNN` | `10.46` | `109.33` | `7.09` | **`—`** | **`—`** | `-0.146` *(fallback `r2`)* | `51.9%` | `+1.09` | `0.275` |
| `Red neuronal` | `12.92` | `166.86` | `8.79` | **`—`** | **`—`** | `-0.748` *(fallback `r2`)* | `49.8%` | `+4.68` | `0.000` |
| `Ingenuo (promedio histórico)` | `10.20` | `103.97` | `6.99` | **`—`** | **`—`** | `0.000` *(fallback fijo)* | — | — | — |

---

## 7. Pendientes del informe anterior

| Pendiente | Estado | Evidencia | Archivo |
|---|---|---|---|
| Interruptor de `botAutoCopiar` en Ajustes | `OK` | El modal de Ajustes ya renderiza y persiste el interruptor (`AJUSTES_SWITCH: true`). | [`AjustesModal.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/AjustesModal.jsx), [`App.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/App.jsx) |
| Ruta visible a `MisPosicionesView` | `FALTA` | `App.jsx` renderiza `MisPosicionesView` cuando `seccionActiva === 'posiciones'`, pero **sigue sin existir botón ni enlace de navegación** en `Navbar.jsx` ni en `MercadoView.jsx`. | [`App.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/App.jsx#L447), [`Navbar.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/Navbar.jsx#L1-L100) |
| Suscripciones sin uso (`bot/winrate`, `bot/dm`) | `FALTA` | `BotView.jsx` sigue declarando `winrateDoc` y `dmDoc` sin consumirlos en el JSX; `TelegramMenuPanel.jsx` permanece sin montarse. | [`BotView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotView.jsx#L137-L138) |
| Usuarios de prueba en colección `ranking` | `FALTA` | Permanecen 3 usuarios claramente de prueba (y 1 por confirmar) sin autorización previa de borrado — ver lista exacta abajo. | `ranking` (Firestore) |
| Etiqueta `"hoy"` vs `"24h"` en acciones y chip `"Mercado cerrado"` | `OK` | Cripto muestra `"24h"`, acciones/ETFs muestran `"hoy"` según `abierto`, y `Mercado` mostró `3` chips `"Mercado cerrado"` en vivo. | [`usePreciosVivo.js`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/hooks/usePreciosVivo.js#L126), [`MercadoView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/MercadoView.jsx#L452-L454), [`BotView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotView.jsx#L394) |

**Usuarios encontrados actualmente en `ranking` (no se borró ninguno):**

| `uid` | `nombre` | `xp` | Estado / Correo observado |
|---|---|---|---|
| `MZgwu5ykyaXfoyiOHdaEFuQuWDp2` | `Ana Chartista` | `22` | Prueba (`chartista_1794504839842@udem.edu.mx`) |
| `UafQLEVI76dp5p4oIzRR89zPWwC3` | `Test Chart` | `0` | Prueba (sin documento en `usuarios`) |
| `Z8SzfupxiuQZaawhprYFALvWmnP2` | `Test Chart` | `0` | Prueba (sin documento en `usuarios`) |
| `Su7RErSJOzUMb0XedxXqK7ffh023` | `pepep` | `102` | Por confirmar con el usuario (`pepep@gmail.com`) |
| `ZoyIaCoWoIWITg7NkRXsYz1laSV2` | `Dylan Lázaro Hernández` | `42` | Usuario real (`dylan.lazaro@udem.edu`) |

---

## 8. Seguridad (`git ls-files`)

| Verificación | Estado | Evidencia | Archivo |
|---|---|---|---|
| `.env` y credenciales JSON fuera de Git | `OK` | `bot/.env`, `firebase-credenciales.json` y `bot/firebase-credenciales.json` **no están rastreados** en Git (solo `bot/.env.example` está rastreado). | `git ls-files` |
| Llaves escritas en archivos `.py` rastreados (`os.getenv` con default largo) | `FALTA` | `bot/bot_quant_x10_app.py` **sí está rastreado en Git** y mantiene valores por defecto hardcodeados dentro de `os.getenv(...)`. | [`bot_quant_x10_app.py`](file:///Users/macintoshhd/Downloads/kit_antigravity/bot/bot_quant_x10_app.py#L85-L103) |

**Detalle de valores por defecto detectados en `bot/bot_quant_x10_app.py` (solo primeros 6 caracteres):**

| Línea | Variable en `os.getenv(...)` | Primeros 6 caracteres | Longitud | Tipo |
|---|---|---|---|---|
| `85` | `GATE_API_KEY` | `d207a4` | `32` | Secreto API |
| `86` | `GATE_API_SECRET` | `fb9ef8` | `64` | Secreto API |
| `87` | `TELEGRAM_BOT_TOKEN` | `857594` | `46` | Token bot |
| `90` | `GEMINI_API_KEY` | `AQ.Ab8` | `53` | Secreto API |
| `91` | `GEMINI_MODEL` | `gemini` | `16` | Nombre de modelo (config) |
| `94` | `XAI_API_KEY` | `xai-PM` | `84` | Secreto API |
| `95` | `XAI_MODEL` | `grok-4` | `8` | Nombre de modelo (config) |
| `101` | `GATE_TESTNET_KEY` | `ecb4b2` | `32` | Secreto API |
| `102` | `GATE_TESTNET_SECRET` | `a68741` | `64` | Secreto API |
| `103` | `GATE_TESTNET_HOST` | `https:` | `37` | URL host (config) |

---

## 9. Errores de consola y permisos (recorrido por las 6 pestañas + subpestañas + Ajustes)

| Verificación | Estado | Evidencia | Alcance probado |
|---|---|---|---|
| Consola del navegador (`console.error`) | `OK` | `[]` (`0` errores) durante toda la sesión automatizada con usuario de prueba. | `Mercado`, `Trading (bot)` (`Operaciones`, `Resultados`), `Portafolio` (+ `Calcular`), `Aprender`, `Modelo ML`, `Analista IA`, `Ajustes` |
| Excepciones no capturadas (`pageerror`) | `OK` | `[]` (`0` errores). | Mismo recorrido |
| Permisos de Firestore (`Missing or insufficient permissions`) | `OK` | `0` errores de permisos reportados en consola en todas las lecturas/escrituras ejecutadas. | Lectura de mercado/bot/ranking + escritura en `portafolios`/`comandos` de prueba |

---

## Lista priorizada para la entrega del 17 de noviembre

### P0 — Bloqueantes / Críticos (hacer primero)
1. **Desplegar Hosting público (`https://bolsalab-udem.web.app`)**: unificar o apuntar el bloque `hosting` (`public: "app/dist"` + rewrite SPA `** -> /index.html`) desde el `firebase.json` raíz (o ejecutar `npm run build` en `app/` y `firebase deploy --only hosting` desde `app/`) para eliminar el `HTTP 404` actual.
2. **Rotar y eliminar secretos de `bot/bot_quant_x10_app.py`**: quitar todos los valores por defecto secretos en las líneas `85–87`, `90`, `94` y `101–102` (`os.getenv('VAR', '')`), cargar todo únicamente desde `bot/.env`, rotar las llaves comprometidas en Gate.io / Telegram / Gemini / xAI y limpiar historial si el repositorio es o será compartido.

### P1 — Rúbrica e Integridad Analítica (alto impacto en evaluación)
3. **Completar `MAPE`, `SMAPE` y `Variance Score` en Portafolio Opción 2**: calcular y guardar `mape`, `smape` y `variance_score` dentro de `ml.rendimiento.modelos[]` y `ml.rendimiento.base` en [`bot_quant_x10_app.py`](file:///Users/macintoshhd/Downloads/kit_antigravity/bot/bot_quant_x10_app.py#L3906-L3917) (actualmente salen `—` y fallback `r2`/`0.000` en `PortafolioMLView.jsx`).
4. **Agregar bloque de Métricas Honestas + nota de comisiones en `Resultados` (`Trading bot`)**: calcular y mostrar sobre `trades_bot` el **Win rate real** (`45.0%`), **Win rate de equilibrio** (`66.0%`), **Profit factor** (`0.44`), **PnL excluyendo cierres manuales** (`+$26.51` vs `-$124.65` total) y la leyenda explícita **`"Resultados sin comisiones"`**.
5. **Enriquecer `Operaciones del bot`**: registrar timestamp de apertura en `trades_bot` para mostrar apertura, cierre y duración; añadir explicación en español del motivo/señal, filtros (activo/lado/estrategia/motivo) y botón **Exportar CSV** en [`BotView.jsx`](file:///Users/macintoshhd/Downloads/kit_antigravity/app/src/components/BotView.jsx#L1249-L1303).

### P2 — Navegación, Limpieza y Consistencia (antes de demo final)
6. **Habilitar ruta UI a `MisPosicionesView`**: añadir enlace/botón visible en `Navbar.jsx` o `MercadoView.jsx` para acceder a `seccionActiva === 'posiciones'`.
7. **Unificar reporte de origen del bot (`Spyder` vs `VM`)**: que el bot publique su entorno de ejecución en `bot/estado` (en lugar de depender de textos fijos) y actualizar los textos `"VM"` residuales en `AnalistaIAView.jsx`, `usePreciosVivo.js` y `firebase.js`.
8. **Limpiar suscripciones muertas y usuarios de prueba en `ranking`**: remover `winrateDoc` y `dmDoc` sin uso en `BotView.jsx` (o conectarlos a las nuevas métricas honestas) y, previa confirmación tuya, eliminar de `ranking` a `MZgwu5ykyaXfoyiOHdaEFuQuWDp2`, `UafQLEVI76dp5p4oIzRR89zPWwC3`, `Z8SzfupxiuQZaawhprYFALvWmnP2` (y `Su7RErSJOzUMb0XedxXqK7ffh023` si confirmas que es de prueba).
