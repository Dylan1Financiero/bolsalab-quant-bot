# BolsaLab — especificación de la app (léela completa antes de programar)

App web educativa: simulador de casa de bolsa + juego para aprender chartismo + panel en tiempo real de un
bot de trading que corre en una VM de Google Cloud. Proyecto final universitario (Finanzas Computacionales).
Todo el texto de la interfaz va en **español**.

## 1. Requisitos de la rúbrica (todos obligatorios)
1. Autenticación de usuarios con **Firebase Authentication** (correo/contraseña y Google).
2. Núcleo cuantitativo: **panel conectado en tiempo real a un bot de trading en una VM** (vía Firestore).
3. Como el bot usa Machine Learning, la app **muestra en pantalla** la validación del modelo: RMSE, MSE, MAE,
   MAPE, SMAPE, Variance Score, Matriz de Confusión, F1-Score y test Diebold-Mariano.
4. **Motor de IA**: análisis e interpretación con Gemini.
5. **Publicada con URL pública** (Firebase Hosting).

## 2. Stack
- Vite + React (JavaScript) y CSS propio. Sin backend propio: solo Firebase JS SDK (Auth + Firestore).
- Gráficos: widget embebido de **TradingView** (`https://s3.tradingview.com/tv.js`) en el simulador y la
  librería **lightweight-charts** (npm, de TradingView) en el juego y en el panel del bot.
- `firebase.json` con hosting `public: "dist"` y las reglas de `firestore.rules` (ya incluidas, no cambiarlas).
- El `firebaseConfig` va en `src/firebaseConfig.js`. **Ninguna llave secreta en el frontend** (ni Gemini).

## 3. Contrato de datos en Firestore (NO cambiar nombres: el bot ya escribe así)
El bot (`bot/bot_quant_x10_app.py`, ya terminado, no modificarlo) escribe con Admin SDK. La app solo lee,
salvo donde se indica.

| Ruta | Quién escribe | Contenido |
|---|---|---|
| `usuarios/{uid}` | app | `{nombre, email, saldo, plan: "free"\|"pro", posiciones: {SYM: {cant, costo}}, xp, aciertos, intentos, racha, rachaMax, creado}` |
| `usuarios/{uid}/ordenes/{id}` | app | `{ts(ms), tipo: "compra"\|"venta", sym, cant, precio, total, comision}` |
| `ranking/{uid}` | app | `{nombre, xp, rend}` (rend = rendimiento % del portafolio) |
| `mercado/precios` | bot (cada 60 s) | `{SYM: {p, chg}, ..., ts}` para los 28 activos |
| `bot/estado` | bot (cada 30 s) | `{asset, asset_name, clase, timeframe, strategy, strategy_label, trading_enabled, leverage, balance, realized_pnl, position\|null, last_signal, signal_now, signal_text, price, risk: {key, label, val, limit, blocked, all: [{label, val, limit, blocked, target}]}, vm: {cpu, ram}, uptime_min, ts(segundos)}` |
| `bot/velas` | bot | `{asset, tf, candles: [{t(seg), o, h, l, c}]}` (300 velas) |
| `bot/validacion` | bot | `{asset, tf, horizonte, n_train, n_test, tabla: [{modelo: "Random Forest"\|"CatBoost", arboles, prof, rmse, mse, mae, mape, smape, evs, dm, p, acc, f1}], mejor(índice), matriz(3x3, orden Sell/Hold/Buy), veredicto, rf_vs_catboost: {dm, p, ganador, rmse_rf, rmse_cat}\|null, catboost(bool), ts}` |
| `trades_bot/{id}` | bot | `{ts(ms), activo, lado, estrategia, temporalidad, entrada, salida, motivo, roe_pct, pnl_usdt}` |
| `bot/winrate` | bot | `{n, ganadores, perdedores, winrate, pnl_total, promedio_ganador, promedio_perdedor, profit_factor\|null, mejor, peor, max_drawdown, roe_promedio, ultimos: [1\|0 x10], por: [{grupo: "estrategia"\|"activo"\|"lado", nombre, n, winrate, pnl}], ts}` (si `n == 0` no hay trades) |
| `bot/dm` | bot | `{asset, tf, velas: {dm, p, n, horizonte, rmse_rf, arboles, prof, gana_rf}, trades: {n, suficiente, dm?, p?, mae_rf_pct?, mae_rw_pct?, gana_rf?}, ultimas_predicciones: [{activo, lado, entrada, tp_rf, salida, error_pct, motivo}], rf_vs_catboost: {dm, p, ganador, rmse_rf, rmse_cat}\|null, ts}` |
| `telegram_espejo/{id}` | bot | Copia en vivo del chat de Telegram del bot: `{ts(ms), de: "bot"\|"usuario", texto, tipo: "texto"\|"foto"\|"archivo"\|"boton", botones: [texto de cada fila del teclado], adjunto_b64?, adjunto_tipo?, adjunto_nombre?}`. Si `tipo` es `foto`, `adjunto_b64` es el PNG del gráfico (mostrarlo como imagen con `data:image/png;base64,...`). Si es `archivo`, es el Excel (botón para descargarlo con `adjunto_nombre`) |
| `portafolios/{id del comando}` | bot | Resultado del portafolio con ML: `{uid, perfil, capital, anios, max_peso, mezcla_ml, tasa_libre(%), desde, hasta, dias, activos: [{sym, nombre, clase, regimen: "baja"\|"media"\|"alta", prob_regimen(0-1), rend_ml, rend_hist, rend_usado, volatilidad, tope(0-1)}], faltan, frontera: [{rendimiento, volatilidad, sharpe}], carteras: [{nombre, descripcion, pesos: [{sym, nombre, clase, peso(0-1), monto, precio, cantidad, regimen}], rendimiento, volatilidad, sharpe, sortino, var95_dia, cvar95_dia}], fuera_de_muestra: {desde, hasta, sharpe_con_ml, sharpe_historico, minima_varianza, paridad_riesgo, pesos_iguales, spy?}\|null, ml: {regimen: {modelos: [{modelo, accuracy, f1, dm, p}], mejor, matriz(3x3 baja/media/alta), base: {modelo, accuracy, f1}, etiquetas}, rendimiento: {modelos: [{modelo, rmse, mse, mae, r2, acierto_direccion, dm, p}], mejor, matriz_direccion(2x2 baja/sube), etiquetas_direccion, base: {modelo, rmse, mae}}, n_train, n_test, corte, horizonte_dias, temporalidad, variables}, aviso, ts}`. Porcentajes ya en %. `carteras[0]` es la recomendada. Rendimientos y RMSE/MAE en % sobre 20 días |
| `bot/menu` | bot (cada 30 s y tras cada botón) | **El menú de Telegram tal cual**: `{titulo, principal: filas, temporalidades: filas, clases: filas, activos: {CRYPTO\|STOCK\|ETF: {label, icon, filas}}, ts}`. `filas` = `[[{t: texto del botón, d: callback_data}]]`. Los textos ya traen emojis, ✅ de lo seleccionado y el semáforo de riesgo |
| `comandos/{id}` | app (solo Pro) | `{uid, tipo, valor, estado: "pendiente", ts(ms)}`. tipo: `toggle` (valor null), `tf` (1m/5m/15m/30m/1h/4h/1d), `activo` (símbolo), `estrategia` (RSI, EMA50_200, BOLLINGER, FIBONACCI, SUPERTREND, CHARTISMO), `validar`, `dm` (recalcula validación y Diebold-Mariano), y las órdenes **`long`**, **`short`**, **`cerrar`** (valor null), y **`portafolio`** (valor = `{perfil: "conservador"\|"moderado"\|"agresivo", capital, activos: [sym] o null (= automático), max_peso (0-1, por defecto 0.35), anios (por defecto 5)}`; **lo puede pedir cualquier usuario, no solo Pro**; el bot responde en `resultado` y deja el detalle en `portafolios/{id del comando}`, cuyo id va en `portafolio_id`), y **`telegram`** (valor = `callback_data` de un botón de `bot/menu`: ejecuta exactamente ese botón del bot de Telegram; permitidos los que empiezan con `SETTF:`, `SETASSET:`, `STRAT:`, `RISK:` o `ACT:`). El bot cambia `estado` a `"hecho"` y, en las órdenes, agrega `resultado` (texto con lo que pasó: apertura, cierre o bloqueo por riesgo) |
| `consultas/{id}` | app crea, bot responde | app: `{uid, pregunta, contexto, estado: "pendiente", ts(ms)}`. El bot cambia a `estado: "lista"` y agrega `respuesta`. `contexto: "BOT"` = analizar el estado del bot; otro texto = contexto del usuario (su portafolio); vacío = pregunta libre |

`bot/estado` trae además `instancia` (id de la ejecución del bot). Si la app ve que `instancia` cambia y vuelve a un valor anterior en menos de 2 minutos, hay dos bots corriendo: mostrar el aviso "Hay dos bots corriendo; reinicia el kernel de Spyder".

`position` (cuando existe): `{asset, timeframe, strategy, side: "LONG"|"SHORT", entry, margin_usdt, leverage, notional_usdt, qty, sl, tp, liq, entry_utc}`.

**IA**: la app crea un doc en `consultas`, escucha ese doc con `onSnapshot` hasta `estado == "lista"` y muestra
`respuesta`. Tiempo máximo 90 s; si se agota: "El bot no respondió. Revisa que la VM esté encendida."

## 4. Catálogo (28 activos)
Símbolo interno → símbolo TradingView.
- **Cripto** (precio tick a tick por WebSocket público de Binance, stream `<par>@miniTicker`, p. ej.
  `wss://stream.binance.com:9443/stream?streams=btcusdt@miniTicker/ethusdt@miniTicker/...`; `c` = precio,
  `o` = apertura 24 h; respaldo: `mercado/precios`): BTC_USDT→BINANCE:BTCUSDT, ETH_USDT, SOL_USDT, XRP_USDT,
  BNB_USDT, DOGE_USDT, ADA_USDT, AVAX_USDT, LINK_USDT, LTC_USDT (mismo patrón).
- **Acciones** (precio solo de `mercado/precios`): NVDA, AAPL, TSLA, MSFT, AMZN, GOOGL, META, AMD, NFLX →
  `NASDAQ:<sym>`; JPM → `NYSE:JPM`.
- **ETFs** (precio solo de `mercado/precios`): SPY, IWM, DIA, GLD, XLK, EEM → `AMEX:<sym>`; QQQ, TLT → `NASDAQ:<sym>`.
Si un activo no tiene precio, mostrar "sin precio" y deshabilitar el botón de orden con la nota
"Las acciones y ETFs reciben precio del bot en la VM".

## 5. Pantallas
Barra superior: logo, navegación (Mercado · Juega y aprende · Bot de trading [PRO] · Modelo ML · Analista IA),
patrimonio del usuario, chip FREE/PRO, nombre, Salir.

### 5.1 Acceso
Iniciar sesión / crear cuenta (nombre, correo, contraseña ≥ 6) y botón "Continuar con Google". Al crear cuenta
se crea `usuarios/{uid}` con `saldo: 100000`, `plan: "free"`, `posiciones: {}`, contadores en 0. Si entra con
Google y no existe el doc, crearlo igual. Errores de Firebase traducidos al español.

### 5.1 bis — Bienvenida y perfil del usuario (onboarding)
Se muestra después de crear la cuenta (y después del video de introducción), una sola vez; se puede repetir desde
el menú del usuario ("Cambiar mi objetivo"). Pantallas tipo asistente, una pregunta por pantalla, con barra de progreso:
1. **¿Qué te trae a BolsaLab?** (una opción, con ícono y una línea de descripción):
   - "Quiero aprender a leer gráficos" → Juega y aprende.
   - "Quiero hacer trading de corto plazo (day trading)" → Mercado. Opera por su cuenta; el bot automático (Pro) se
     le recomienda como opción, nunca es obligatorio.
   - "Quiero invertir a largo plazo y armar mi portafolio" → Portafolio.
   - "Quiero explorar todo" → Mercado.
2. **¿Cuánta experiencia tienes invirtiendo?** Ninguna / Algo / Bastante.
3. Solo si eligió trading o largo plazo — **perfil de riesgo** (3 preguntas, cada respuesta vale 1, 2 o 3 puntos):
   - Si tu inversión cae 20% en un mes: vendo todo (1) / espero (2) / compro más (3).
   - ¿Para cuándo necesitas el dinero? menos de 1 año (1) / 1 a 5 años (2) / más de 5 años (3).
   - ¿Qué prefieres? no perder (1) / equilibrio (2) / máximo crecimiento aunque haya caídas fuertes (3).
   Suma 3–4 = conservador, 5–7 = moderado, 8–9 = agresivo.
4. **Tu plan recomendado**: tarjeta con el perfil, por qué, la sección a la que lo lleva y 2-3 recomendaciones:
   - Gráficos: empezar por la Biblioteca y el modo "Identifica la figura"; meta de 50 XP para llegar a Aprendiz.
   - Trading: operar en Mercado por su cuenta con montos pequeños, usar el Panel de análisis (chartismo y riesgo) y,
     como opción, el plan **Pro** para que el bot opere por él (botón "Conocer el bot").
   - Largo plazo: ir a Portafolio con el perfil ya elegido y su capital.
   Botones "Ir ahora" y "Ver todo primero".
Guardar en `usuarios/{uid}`: `objetivo` (graficos\|trading\|largo_plazo\|explorar), `experiencia`, `perfil_riesgo`,
`puntaje_riesgo`, `onboarding_ok: true`. Usuarios ya existentes sin `onboarding_ok` también lo ven al entrar.
El inicio muestra una tarjeta "Tu plan" con el objetivo y un acceso directo a su sección.

### 5.2 Mercado (simulador de casa de bolsa)
- 4 indicadores: Efectivo, Valor de posiciones, Patrimonio, Rendimiento total (% sobre 100,000).
- Izquierda: pestañas Cripto / Acciones / ETFs y lista con precio y cambio % en vivo.
- Centro: nombre, precio, cambio y fuente del precio + widget de TradingView del activo elegido (tema oscuro,
  intervalo 15, locale es, zona America/Monterrey).
- Derecha: boleta de orden a mercado. Pestañas Comprar/Vender, monto en USD, atajos 10/25/50/Máx, resumen
  (precio, cantidad, comisión 0.10%, cuánto tienes).
  - Compra: `monto + comisión ≤ saldo`; costo promedio ponderado; `saldo -= monto + comisión`.
  - Venta: no más de lo que tiene; `saldo += monto − comisión`; si queda en ~0, borrar la posición.
  - Guardar saldo y posiciones en una sola escritura y agregar el doc de la orden.
- Abajo: tabla "Mi portafolio" (cantidad, costo prom., precio, valor, P&L $ y %) con botón "Analizar con IA"
  (crea consulta con el portafolio como contexto), y tabla "Historial de órdenes" (últimas 30).
- Publicar `ranking/{uid}` con `rend` como máximo una vez por minuto.

### 5.3 Juega y aprende (chartismo)
Los datos están en `datos/figuras_chartismo.json` (**38 figuras y lecturas**: cambio de tendencia, continuación,
canales, niveles que cambian de papel, falsas rupturas, rupturas de línea de tendencia y retrocesos de Fibonacci). **No usar imágenes en el juego**: cada gráfico
se genera con código a partir de los puntos. Las imágenes de `referencias/` solo muestran cómo debe verse.

Generación de velas (igual para `puntos` y `continuacion`): se recorren los tramos entre puntos consecutivos;
para cada vela `x` del tramo, `cierre = (interpolación lineal de y + ruido) × escala`, con ruido uniforme en
±1.1 (cero exactamente en los puntos clave); `apertura = cierre de la vela anterior`; `máximo = max(a, c) +
aleatorio(0–0.9)×escala`; `mínimo = min(a, c) − aleatorio(0–0.9)×escala`. `escala` = uno de
[0.012, 0.31, 1.7, 24, 610] × aleatorio(0.8–1.2), para que el precio no delate la figura. La continuación
empieza en el último punto de `puntos`. Tiempo de cada vela: `1700000000 + x × 86400`.

Modos (pestañas):
1. **Identifica la figura**: muestra solo la formación; 4 opciones (la correcta + 3 al azar, mezcladas).
2. **¿Sube o baja?**: misma formación; opciones "▲ Sube" / "▼ Baja" (compara con `direccion`).
3. **Biblioteca**: una tarjeta por figura, agrupadas por `tipo`; al elegirla muestra el ejemplo ya resuelto y su explicación (sin XP).

Al responder: marcar correcta en verde y el error en rojo, **revelar la continuación**, dibujar las `lineas`
(punteadas; rol resistencia = rojo, soporte = verde, cuello = lila, fibonacci = ámbar), poner una flecha con el
texto del campo `etiqueta` ("Ruptura", "Rebote", "Rechazo", "Falsa ruptura"…) en la vela `ruptura`
(arriba si baja, abajo si sube) y mostrar la ficha: nombre, tipo, dirección, `que_es`, `senal`,
`como_se_opera`, más la nota "Las figuras no se cumplen siempre: por eso se espera la ruptura y se usa stop."
Botón "Siguiente".

Progreso (se guarda en `usuarios/{uid}`): acierto = +10 XP + bono de racha `min(racha−1, 5) × 2`; fallo = racha 0.
Niveles en el JSON (`niveles`). Arriba: Nivel con barra de progreso, XP y cuánto falta, Racha (y máxima),
Aciertos (n/total y %). A la derecha: ranking top 10 por XP (colección `ranking`).

### 5.4 Bot de trading (solo plan Pro)
- Usuario Free: pantalla de candado con comparación Free vs Pro ($199 MXN/mes) y botón "Activar Pro".
  **Pago simulado**: solo escribe `plan: "pro"` en su perfil y lo dice ("no se realiza ningún cargo").
- Usuario Pro, con `onSnapshot` sobre `bot/estado`, `bot/velas` y `trades_bot` (últimos 25):
  - Indicadores: Estado de la VM (En línea si `ahora − ts < 120 s`, con "último latido hace X s", CPU y RAM),
    Auto-Trading (Encendido/Pausado + botón que manda comando `toggle`), Saldo del bot y PnL realizado,
    Filtro de riesgo activo (valor vs límite; rojo "entradas bloqueadas" si `blocked`).
  - Gráfico de velas (lightweight-charts) con `bot/velas`; si hay posición del mismo activo, líneas de
    Entrada, TP y SL. Debajo, la posición con PnL abierto = `(price/entry − 1) × (±1) × margin_usdt × leverage`.
  - Control: selects de Temporalidad (1m, 5m, 15m, 30m, 1h, 4h, 1d), Activo (agrupado por clase) y Estrategia; al cambiar, crear el comando.
  - "Métricas y límites de riesgo": las 3 de `risk.all` con semáforo y a qué clase de activo aplica.
  - Botón "Analizar con Gemini" (consulta con `contexto: "BOT"` y pregunta vacía).
  - **Operar desde la app** (ejecución real en el bot): botones "Comprar / Long x10", "Vender en corto / Short x10"
    y "Cerrar posición". Cada uno pide confirmación, crea el comando (`long`, `short`, `cerrar`), escucha ese
    documento con `onSnapshot` y muestra el `resultado` que escribe el bot (puede ser "ENTRADA BLOQUEADA POR
    RIESGO": mostrarlo en rojo). Deshabilitar Long/Short si ya hay posición y Cerrar si no la hay.
  - **Telegram en vivo (espejo)**: panel con aspecto de chat que muestra los últimos 40 documentos de
    `telegram_espejo` ordenados por `ts`, en tiempo real y con auto-scroll al final. Mensajes del bot a la
    izquierda, del usuario a la derecha (`tipo: "boton"` = botón que tocó en Telegram). Conservar saltos de
    línea y emojis. Si el mensaje trae `botones`, dibujarlos debajo como filas de botones grises NO clicables
    (cada elemento es una fila; dentro, los botones vienen separados por ` | `). Encabezado: "Telegram en vivo"
    con un punto verde si el último mensaje tiene menos de 2 minutos.
  - Botón **"Reporte Winrate"**: tarjeta o modal con `bot/winrate`: winrate %, ganados/perdidos, PnL total,
    ganancia y pérdida promedio, profit factor, caída máxima, mejor y peor trade, racha de los últimos 10
    (puntos verdes y rojos) y tabla por estrategia, por activo y por lado. Si `n < 20`, aviso "muestra pequeña".
    Si `n == 0`: "Aún no hay trades cerrados".
  - Botón **"Test Diebold-Mariano (RF)"**: manda el comando `dm` y muestra `bot/dm` en una tarjeta con dos
    bloques: A) velas fuera de muestra (DM, p-valor, n, horizonte, `velas.modelo`), C) Random Forest vs CatBoost
    (`rf_vs_catboost`) y B) últimos trades (DM, p-valor, error medio
    del objetivo del RF vs modelo ingenuo; si `suficiente` es false: "Se necesitan al menos 8 trades cerrados"),
    más la tabla `ultimas_predicciones` (activo, lado, entrada, objetivo RF, salida real, error %). Veredicto en
    una línea: DM negativo y p < 0.05 = "el Random Forest predice mejor que el modelo ingenuo"; DM positivo y
    p < 0.05 = "predice peor"; en otro caso "sin diferencia significativa".
  - Tabla "Operaciones del bot".

### 5.4 bis — Control remoto: el menú completo de Telegram dentro de la app (solo Pro)
Sección "Panel de Telegram" en el panel del bot: reproduce **todas** las opciones del bot de Telegram.
- Dibuja `bot/menu.principal` como una cuadrícula de botones, fila por fila, con el texto exacto de cada botón
  (emojis, ✅, semáforo rojo/verde incluidos). Encima, `bot/menu.titulo`. Se actualiza solo con onSnapshot.
- Navegación local (no manda comando): `MENU:TF` muestra `bot/menu.temporalidades`; `MENU:ASSET` muestra
  `bot/menu.clases`; `CLASS:<clase>` muestra `bot/menu.activos[<clase>].filas`; `MENU:MAIN` regresa al principal.
- Cualquier otro botón crea el comando `{tipo: "telegram", valor: <callback_data>}`, pone ese botón en estado
  "cargando", escucha el documento del comando y muestra su `resultado` en un panel de respuesta (respetando saltos
  de línea y emojis) más un toast. Los reportes largos (Reporte + Gráfico, Diebold-Mariano) pueden tardar hasta un minuto.
- "Reporte de Bot + Gráfico": además del texto, muestra la imagen del último mensaje `tipo: "foto"` de
  `telegram_espejo`. "Excel + Histórico": botón "Descargar Excel" con el último `tipo: "archivo"`.
- "Analizar con Gemini": después de la respuesta, muestra una caja para escribir una pregunta, que va por `consultas`
  con `contexto: "BOT"`.
- Las acciones que abren o cierran posiciones (comprar LONG, vender/cerrar) piden confirmación antes.
- Todo lo que se hace desde la app también aparece en el chat de Telegram y en el espejo.

### Versión preliminar: TODO GRATIS
En esta versión no se cobra nada. En la configuración de la app existe `PRO_GRATIS = true`:
- Nadie ve el candado ni la pantalla de pago: todos los usuarios entran directo al panel del bot y a todas las
  funciones que antes eran Pro (control del bot, Panel de Telegram, órdenes, espejo, Copiar al bot, Recalcular).
- Se ocultan los chips "PRO", el botón "Activar Pro" y los precios. El onboarding de day trading lleva a Mercado y
  recomienda el bot con el botón "Ir al bot" (directo al panel, sin pago).
- El código del candado y del plan se conserva, solo desactivado, para volver a activarlo después cambiando
  `PRO_GRATIS` a `false` (y la función `esPro()` de firestore.rules).

### 5.0 — "Mis operaciones abiertas" en la pantalla principal (Mercado, arriba de todo)
Panel único, siempre visible, con TODAS las operaciones abiertas en tiempo real, sin importar quién las abrió:
| Origen | De dónde sale | Tipo |
|---|---|---|
| Manual (yo) | `usuarios/{uid}.posiciones` (cuenta spot) | Spot · LONG · x1 |
| Copia del bot | Cuenta Espejo de futuros en `usuarios/{uid}` | Futuros · LONG o SHORT · x10 |
| Bot (su propia cuenta) | `bot/estado.position` | Futuros · LONG o SHORT · x(leverage) |
Columnas: origen (chip "Manual" / "Copia bot" / "Bot"), activo, mercado (Spot o Futuros), lado (LONG verde / SHORT
rojo), apalancamiento, entrada, precio actual, P&L en $ y %, SL, TP, liquidación (si aplica), tiempo abierta y
estado ("En ganancia", "En pérdida", "Cerca del SL" si está a menos de 25% de la distancia al SL, "Cerca de
liquidación"). Arriba del panel: totales de P&L abierto por origen y número de operaciones.
Acciones por fila: "Cerrar" (y 25/50% en spot) con confirmación; en la fila del Bot, "Cerrar" manda el comando
`cerrar`. Al tocar una fila se abre ese activo en el gráfico. Si no hay operaciones: "No tienes operaciones abiertas".
Debajo, "Operaciones cerradas recientes" (mías, de mi copia y del bot) con P&L y motivo.

**Cambio de temporalidad, activo y estrategia:** el comando devuelve `resultado` (p. ej. "✅ Temporalidad cambiada a
5 min" o el error). La app lo muestra como toast y NO cambia el selector hasta que `bot/estado.timeframe` lo
confirme. Si en el Panel de Telegram el usuario toca `MENU:TF`, `MENU:ASSET`, `CLASS:...` o `MENU:MAIN`, la
navegación es local; si por error se manda como comando `telegram`, el bot responde con `submenu` (filas) y la
app debe dibujarlo.

### 5.0 bis — Pestaña "Mis posiciones" + cierre con vista previa de ganancia/pérdida (SIN comisiones)
**Versión preliminar sin comisiones:** constante `COMISION = 0` en un solo lugar (src/config). Toda compra, venta,
long, short y cierre se ejecuta al precio en vivo exacto, sin comisión ni spread. Si hoy hay cualquier comisión,
spread o redondeo que reste saldo, quitarlo. Debajo del saldo, texto chico: "Simulación sin comisiones".
Dejar en Ajustes una sección **"Comisiones"** solo informativa: "Comisión por operación: 0% (versión preliminar).
Más adelante se activará 0.05% por lado." con el valor leído de `COMISION`.

**Nueva pestaña "Mis posiciones"** en la barra (junto a Mercado). Tarjetas grandes, una por posición abierta, de los 3
orígenes de 5.0 (Manual spot, Copia bot, Bot). Cada tarjeta muestra:
- Activo y nombre, chip de origen, chip LONG (verde) / SHORT (rojo), Spot o Futuros x10.
- Entrada → precio actual, cantidad, monto invertido (margen).
- **P&L en vivo en grande**: "+$12.40 (+0.83%)" en verde o "−$1.16 (−0.08%)" en rojo, actualizado con cada precio.
  Fórmula sin comisiones: LONG = (actual − entrada) × cantidad; SHORT = (entrada − actual) × cantidad;
  % = P&L / margen × 100. Bot: usar `bot/estado.position` (entry, side, qty, margin_usdt, leverage, sl, tp, liq)
  y `bot/estado.price`.
- SL, TP y liquidación cuando existan; tiempo abierta.
- Botón **"Cerrar esta posición"**. Al tocarlo abre un modal de confirmación:
  - si P&L ≥ 0: "Si cierras esta posición ahora vas a tener una **ganancia de $12.40 (+0.83%)**" (verde);
  - si P&L < 0: "Si cierras esta posición ahora vas a tener una **pérdida de $1.16 (−0.08%)**" (rojo);
  - el monto se recalcula en vivo mientras el modal está abierto; botones "Cerrar posición" y "Cancelar".
  - Al confirmar: manual/copia → cerrar en Firestore al precio en vivo; Bot → comando `cerrar`. Después, toast con el
    resultado real ("Posición cerrada: ganaste $12.38") y la tarjeta pasa a "Cerradas hoy".
- Arriba de la pestaña: total P&L abierto, número de posiciones, total ganado/perdido hoy (cerradas).
- Sin posiciones: "No tienes posiciones abiertas" + botón "Ir a Mercado".

**Arreglo del botón "Cerrar posición" del panel Bot de trading (hoy confunde):**
- Si NO hay posición abierta en el activo actual: no mostrar el botón; en su lugar texto gris
  "No tienes posición abierta en BTC".
- Si hay: el botón dice exactamente qué cierra y cuánto: "Cerrar LONG BTC x10 · +$3.20" (verde) o
  "Cerrar SHORT BTC x10 · −$1.16" (rojo) y abre el mismo modal de arriba.
- Si hay más de una (mía y del bot), un botón por posición con su chip de origen.
- En la tabla "Mi portafolio" de Mercado agregar columna "Acción" con el mismo botón "Cerrar" por fila.

### 5.4 ter — Análisis técnico dibujado en la gráfica en vivo (pestaña Bot de trading)
El bot publica `bot/analisis` cada vez que se genera un reporte (Telegram o app), cuando la app manda el comando
`{tipo:'analisis'}` y, en modo en vivo, en cada vela cerrada. Contenido:
`asset, tf, estrategia, estrategia_label, ts, vela_t, precio, senal, senal_txt, resumen,`
`lineas[{nombre,t1,p1,t2,p2,color,estilo('solida'|'punteada'|'rayas'),ancho}]` (techo/base del canal, impulso y
abanicos de Fibonacci, Gann), `niveles[{nombre,precio,color,estilo,panel?}]` (gatillos LONG/SHORT, objetivos,
niveles Fib, soporte/resistencia, entrada/SL/TP de la posición del bot), `series[{nombre,panel('precio'|'rsi'),
color,ancho,puntos[{t,v,color?}]}]` (EMA 50/200, Bandas de Bollinger, SuperTrend con color por punto, RSI),
`zonas[{nombre,desde,hasta,t1,color}]` (gaps abiertos) y `marcadores[{t,precio,posicion('arriba'|'abajo'),
forma('circulo'|'flecha_arriba'|'flecha_abajo'),color,texto}]` (pivotes H/L, señal actual). Tiempos en segundos UTC.

En la gráfica de velas de **Bot de trading** (lightweight-charts, gratis; NO el widget de TradingView de Mercado,
que no permite dibujar por código):
- Dibujar todo lo anterior encima de las velas: `lineas` como line series de 2 puntos, `niveles` con
  `createPriceLine` (con su nombre como etiqueta), `series` como line series (las de panel `rsi` en una escala
  aparte abajo), `zonas` como 2 price lines con relleno si se puede, `marcadores` con `setMarkers`.
- Al llegar un `bot/analisis` nuevo se BORRA el dibujo anterior y se dibuja el nuevo (así, si pides otro reporte
  5 minutos después, el análisis cambia).
- Solo dibujar si `analisis.asset` y `analisis.tf` coinciden con lo que muestra la gráfica; si no, mostrar
  "El análisis es de otro activo/temporalidad — pide uno nuevo".
- Arriba de la gráfica: chip "Análisis Chartismo · 1m · hace 2 min" + `resumen` + señal (LONG/SHORT/En espera).
- Botones: "Actualizar análisis" (comando `{tipo:'analisis'}`), interruptor "En vivo" (comando
  `{tipo:'analisis', valor:'vivo'}` / `'off'`) y "Ocultar dibujo". Leyenda con el nombre y color de cada línea.
- Es el mismo análisis del reporte PNG: no recalcular nada en la app.
- El bot publica el mismo análisis también en `bot/analisis_grafico` (formato de la v3.2: `lineas[{nombre,color,
  width,style,datos[{time,value}]}]`, `niveles[{titulo,precio,color}]`, `marcadores[{time,position,color,shape,text}]`).
  Si la app ya dibuja ese documento, puede seguir usándolo; solo asegúrate de que el botón "Actualizar análisis" y el
  modo "En vivo" (comando `analisis`) también lo refrescan. No dibujes los dos a la vez.

### 5.7 Portafolio de inversión a largo plazo con Machine Learning (Opciones 1 y 2 del proyecto; Free y Pro)
Nueva pestaña **"Portafolio"** en la barra (entre Mercado y Juega y aprende). Narrativa que debe verse en la pantalla
(encabezado de 3 pasos): **1) Clasificamos el riesgo** de cada activo (régimen de volatilidad, Opción 1) →
**2) Estimamos su rendimiento** con modelos de regresión (Opción 2) → **3) Optimizamos** con Markowitz y Paridad de
Riesgo según tu perfil. Temporalidad del modelo: **diaria**, horizonte 20 días (explicar: es inversión de largo plazo;
en 5 o 15 minutos el ruido y las comisiones dominan).

- **Configurar**: perfil (precargado del onboarding, editable), capital (por defecto mi efectivo), años de historia
  (3, 5 o 10), peso máximo por activo (20/35/50%), activos "Automático" o elegidos a mano (mínimo 3). Botón "Calcular".
  Crear comando `portafolio`; mostrar progreso "Entrenando modelos y optimizando… (≈30–60 s)"; esperar `portafolio_id`.
- **Paso 1 — Riesgo por activo (Opción 1)**: tabla de `activos` con semáforo de régimen (baja verde, media ámbar,
  alta rojo) y su probabilidad, volatilidad anual y tope de peso que le asignó el perfil. Nota: "Conservador no
  invierte en activos de régimen alto; Moderado les pone tope de 10%".
- **Paso 2 — Rendimiento esperado (Opción 2)**: por activo, rendimiento del modelo ML, histórico y el usado
  (mezcla `mezcla_ml`, 50/50), en barras comparativas.
- **Paso 3 — Carteras**: gráfica de la **frontera eficiente** (X volatilidad %, Y rendimiento %), activos como puntos
  grises y las 5 carteras marcadas (Recomendada, Máximo Sharpe, Mínima varianza, **Paridad de riesgo**, Pesos iguales).
  Tarjeta por cartera: rendimiento anual, volatilidad, **Sharpe**, **Sortino**, VaR y CVaR 95% diario y dona de pesos.
  Tabla de la elegida: activo, clase, régimen, peso %, monto, precio, cantidad.
- **"¿Habría funcionado?"**: `fuera_de_muestra` en barras: Sharpe con ML vs Sharpe histórico vs Mínima varianza vs
  Paridad de riesgo vs Pesos iguales vs SPY, en el periodo `desde`–`hasta`.
- **Validación de los modelos** (subpestaña o acordeón "Validación ML", visible siempre):
  - Opción 1: tabla Random Forest / KNN / Red neuronal con Accuracy, F1 y Diebold-Mariano (DM y p-valor) contra el
    modelo ingenuo (`base`), mejor modelo resaltado, y **matriz de confusión 3×3** (baja/media/alta).
  - Opción 2: tabla con RMSE, MSE, MAE, R², acierto de dirección y Diebold-Mariano contra el promedio histórico,
    y **matriz de confusión 2×2** de dirección (baja/sube).
  - Datos: velas de entrenamiento y prueba, fecha de corte, horizonte, temporalidad y variables usadas.
  - Lectura en una línea por tabla: DM negativo con p < 0.05 = el modelo supera al ingenuo; positivo con p < 0.05 =
    es peor; si no, sin diferencia significativa. Mostrarlo tal cual salga, aunque el modelo pierda.
- **Explicar con IA**: consulta con el resumen (perfil, cartera recomendada, regímenes y validación) como contexto.
- **Invertir**: "Invertir esta cartera" → modal con detalle y comisión total → compra cada activo en mi cuenta spot
  por su monto, con `origen: "portafolio"` y `portafolio_id`. Aparecen en "Mis operaciones abiertas" con chip
  "Portafolio". Activo sin precio en vivo: avisar y no comprarlo.
- **Seguimiento**: tarjeta "Mi portafolio a largo plazo": valor actual, rendimiento desde la compra vs SPY, pesos
  actuales vs objetivo y botón "Rebalancear" (con confirmación). Aviso fijo con el texto `aviso`.

### 5.5 Modelo ML (visible para todos)
Lee `bot/validacion`. Subtítulo: activo, temporalidad, velas de entrenamiento y de prueba. Caja con `veredicto`.
Tabla con una fila por combinación: **Modelo (Random Forest o CatBoost)**, Árboles/Iteraciones, Prof., RMSE, MSE, MAE, MAPE %, SMAPE %, Variance Score,
Diebold-Mariano, p-valor, Accuracy %, F1; resaltar la fila `mejor`. Matriz de confusión 3×3 (Real vs Predicho:
Sell, Hold, Buy) como mapa de calor. Bloque "Cómo leerlo" que explique cada métrica en una línea.
Debajo de la tabla, tarjeta **"Random Forest vs CatBoost"** con `rf_vs_catboost`: RMSE de cada uno, DM, p-valor y
`ganador` (si es null: "CatBoost no está instalado en la VM"). Botón "Recalcular" (solo Pro): comando `validar`.

### 5.6 Analista IA
Chat. Selector de contexto: "Con mi portafolio" (texto con efectivo, posiciones, pesos y P&L), "Con el estado
del bot" (`"BOT"`), "Pregunta libre". 3 preguntas sugeridas. Usa el mecanismo de `consultas`.

## 6. Diseño
Tema oscuro tipo terminal financiera: fondo `#0b0e14`, paneles `#131824`, borde `#252d40`, texto `#e6e9f0`,
texto secundario `#93a0b8`, acento `#7c5cff`, verde `#22c58b`, rojo `#f0506e`, ámbar `#f5b83d`. Números
tabulares. Responsivo: en celular todo en una columna, sin scroll horizontal. Avisos tipo toast.

## 7. Criterios de aceptación
- Registro, cierre de sesión e inicio de sesión funcionan; el saldo y las posiciones persisten.
- Comprar y vender actualiza saldo, portafolio e historial; no deja vender de más ni comprar sin efectivo.
- El juego funciona sin el bot: las 38 figuras del JSON, revelado con líneas, XP y ranking persistentes.
- Con el bot encendido: el panel cambia solo cada ~30 s y los comandos llegan al bot (se ve en `bot/estado`).
- Un Long desde la app abre la posición en el bot, aparece en Telegram y en el espejo; Cerrar la cierra.
- El espejo muestra en vivo lo que pasa en el chat de Telegram; Winrate y Diebold-Mariano muestran sus reportes.
- Cada botón del Panel de Telegram de la app hace lo mismo que en Telegram y su respuesta aparece en ambos lados.
- Una cuenta nueva pasa por el onboarding y queda en la sección recomendada; el perfil se guarda.
- Portafolio calcula régimen de volatilidad y rendimiento esperado con ML, las 5 carteras con frontera, Sharpe y Sortino, muestra la validación (matrices de confusión, F1, RMSE, MSE, MAE y Diebold-Mariano) y se puede invertir y rebalancear.
- Cambiar la temporalidad a 1m o 5m se refleja en `bot/estado.timeframe` y en la app en menos de 5 segundos.
- La pestaña Modelo ML muestra todas las métricas listadas.
- `npm run build` sin errores y `firebase deploy --only hosting,firestore:rules` publica la app.


### 5.7 bis — Validación ML visible en Portafolio (requisito de la Opción 6, punto 3)
En la pestaña Portafolio agrega una sección "Validación de los modelos (Opciones 1 y 2)" con los datos de
`portafolios/{id}.ml`:
- **Opción 1 — Régimen de volatilidad (clasificación, diaria):** tabla de `ml.regimen.modelos`
  (Random Forest, KNN, Red neuronal) con Accuracy, F1 y Diebold-Mariano (DM y p) contra `ml.regimen.base`
  (modelo ingenuo: "el régimen de mañana = el de hoy"); matriz de confusión 3×3 `ml.regimen.matriz`
  (baja/media/alta) con % por fila; texto de temporalidad: "Diaria, horizonte 20 días: en 5 o 15 minutos
  domina el ruido".
- **Opción 2 — Rendimiento a 20 días (regresión):** tabla de `ml.rendimiento.modelos` con RMSE, MSE, MAE,
  MAPE, SMAPE, Variance Score, acierto de dirección, DM y p, más la fila del modelo ingenuo `ml.rendimiento.base`;
  matriz de confusión 2×2 de dirección (sube/baja) `ml.rendimiento.matriz_direccion`.
  Nota bajo la tabla: "RMSE/MSE/MAE en puntos porcentuales de rendimiento; MAPE y SMAPE sobre el precio a 20 días".
- Arriba de cada tabla, una frase generada con los números: si el mejor modelo tiene DM < 0 y p < 0.05,
  "El modelo supera al ingenuo"; si no, "El modelo no supera al ingenuo de forma significativa".
- Sharpe y Sortino ya están en las tarjetas de carteras.
