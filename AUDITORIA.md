# Auditoría Integral de la Aplicación Web — BolsaLab

**Fecha de auditoría:** 13 de noviembre de 2026  
**Proyecto Firebase:** `bolsalab-udem`  
**Fuentes de contraste:** `ESPECIFICACION.md` (secciones 3, 5 y 7) y `CONTEXTO_PARA_GEMINI.md`  
**Alcance:** Revisión estática de código, pruebas automatizadas en navegador (escritorio `1440×960` y móvil `390×844`), inspección de red/Firestore y auditoría de seguridad. No se modificó ningún archivo del código fuente durante esta auditoría.

---

## A. Rúbrica de la Opción 6

| # | Criterio | Estado | Evidencia de prueba y hallazgos |
|---|---|---|---|
| **1** | **Login con Firebase Authentication (correo y Google)** | **OK** | **Probado en navegador:** se creó cuenta nueva con correo y contraseña (`createUserWithEmailAndPassword`), se cerró sesión (`signOut`) y se volvió a iniciar sesión (`signInWithEmailAndPassword`). El botón *"Continuar con Google"* invoca `signInWithPopup(auth, googleProvider)` y ejecuta `asegurarPerfilUsuario` creando `usuarios/{uid}` y `ranking/{uid}` si no existen. Los códigos de error de Firebase Auth se traducen al español en `traducirErrorFirebase` (`app/src/services/firebase.js`). *Nota menor:* el aviso toast al registrarse en `AuthScreen.jsx` dice `"Cuenta creada con $100,000 USD virtuales"` aunque el saldo inicial actual es `$10,000 USD`. |
| **2** | **Panel conectado en tiempo real al bot (`bot/estado` se actualiza solo)** | **OK** | **Probado en navegador (`bot_panel_pro.png`):** `BotView.jsx` y `App.jsx` usan `onSnapshot` sobre `doc(db, 'bot', 'estado')`, `doc(db, 'bot', 'velas')` y `collection(db, 'trades_bot')`. Con el bot encendido, el indicador *"Último latido hace X s"*, el uso de CPU/RAM de la VM, el precio activo, la señal (`LONG`/`SHORT`/`HOLD`) y las 300 velas se actualizan automáticamente cada ~30 s sin recargar la página. |
| **3** | **Métricas ML en pantalla: RMSE, MSE, MAE, MAPE, SMAPE, Variance Score, matriz de confusión, F1, Diebold-Mariano** | **OK** | **Probado en navegador (`modelo_ml_vista.png`):** la pestaña **Modelo ML** (`ModeloMLView.jsx`) suscribe con `onSnapshot` a `bot/validacion` y muestra en la tabla comparativa de las 6 configuraciones del Random Forest todas las métricas exigidas: `Árboles`, `Prof.`, `RMSE`, `MSE`, `MAE`, `MAPE %`, `SMAPE %`, `Variance Score`, `Diebold-Mariano (dm)`, `p-valor`, `Accuracy %` y `F1-Score (macro)`, resaltando la fila `mejor`. Incluye el mapa de calor de la **Matriz de Confusión 3×3** (`Sell`, `Hold`, `Buy`) y el bloque educativo *"Cómo leerlo"*. |
| **4** | **Análisis con Gemini funcionando (vía la colección `consultas`)** | **PARCIAL** | **Probado en navegador (`analista_ia_vista.png` y `bot_gemini_analisis.png`):** la app cumple al 100% la arquitectura: **nunca** llama a Gemini directo; `consultarGemini` crea un documento en `consultas/{id}` con `{ uid, pregunta, contexto, estado: "pendiente", ts }` y escucha con `onSnapshot` hasta `estado == "lista"`. Sin embargo, **del lado del bot** (`bot/bot_quant_x10_app.py`), la lista de modelos (`gemini-3.5-flash`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`) devuelve `404 NOT_FOUND` en la API de Google para llaves nuevas, por lo que el bot escribe `"No se pudo conectar con Gemini (404 NOT_FOUND...)"` en `consultas/{id}.respuesta`. La app detecta ese error y sintetiza en el cliente un diagnóstico estructurado con los datos reales de `bot/estado` o del portafolio para no mostrar el error 404 en pantalla, pero la generación en el bot requiere actualizar `GEMINI_MODEL=gemini-2.0-flash` en `bot/.env` si se desea respuesta directa del LLM de Google. |
| **5** | **URL pública activa: dime cuál es y si abre** | **FALLA** | **Probado con `curl -I https://bolsalab-udem.web.app`:** la URL pública prevista es `https://bolsalab-udem.web.app` (y `https://bolsalab-udem.firebaseapp.com`), configurada en `app/.firebaserc` (`"default": "bolsalab-udem"`) y `app/firebase.json` (`"public": "dist"`). Actualmente devuelve **`HTTP/2 404 — Site Not Found`** porque aún no se ha ejecutado el despliegue de Hosting (`firebase deploy --only hosting,firestore:rules`, correspondiente al Prompt 6). |

---

## B. Funciones en el Navegador

| # | Función | Estado | Evidencia de prueba y hallazgos |
|---|---|---|---|
| **6** | **Mercado: comprar, vender, no deja vender de más ni comprar sin saldo, persiste al recargar** | **PARCIAL** | **Probado en navegador (`mercado_tras_compra.png`, `mercado_tras_venta_mitad.png`, `mercado_tras_recarga.png`, `dashboard_10k_principal.png`):** 1) Precios en vivo por WebSocket de Binance (`@miniTicker`) para las 10 criptomonedas y `mercado/precios` para las 10 acciones y 8 ETFs. 2) Comprar descuenta `monto + comisión (0.10%)` y calcula el costo promedio ponderado; vender acredita `monto - comisión` y elimina la posición si queda en `~0`. 3) Si se intenta comprar por encima del efectivo o vender más unidades de las que se tienen, muestra toast de error y bloquea la operación. 4) Al recargar (`F5`), saldo, posiciones e historial persisten en `usuarios/{uid}` y `usuarios/{uid}/ordenes`. **Por qué es PARCIAL frente a `ESPECIFICACION.md`:** la especificación escrita indica `saldo: 100000` (`$100,000 USD`), mientras que por solicitud expresa del usuario se cambió `SALDO_INICIAL = 10000` (`$10,000 USD`) y se agregó el Dashboard ejecutivo superior. |
| **7** | **Juega y aprende: 38 figuras, 3 modos, revelado con líneas y flecha, XP y ranking persisten** | **OK** | **Probado en navegador (`juego_modo1_revelado.png`, `juego_modo2_revelado.png`, `juego_modo3_biblioteca.png`):** usa las **38 figuras y lecturas** íntegras de `figuras_chartismo.json` generadas con código en `generadorVelasChartismo.js` (sin imágenes estáticas). Funcionan los 3 modos (*Identifica la figura*, *¿Sube o baja?*, *Biblioteca* agrupada por `tipo`). Al responder se revela el tramo `continuacion`, se trazan las líneas punteadas por `rol` (`resistencia` rojo, `soporte` verde, `cuello` lila, `fibonacci` ámbar), la flecha en la vela `ruptura` con el texto `etiqueta`, y la ficha completa con la nota obligatoria. El progreso (`xp`, `racha`, `rachaMax`, `aciertos`, `intentos`) y el Top 10 en `ranking` persisten en Firestore. |
| **8** | **Bot: candado Free/Pro, encender/pausar, cambiar activo, temporalidad y estrategia desde la app** | **OK** | **Probado en navegador (`bot_candado_free.png`, `bot_panel_pro.png`):** 1) Con cuenta `free` muestra la pantalla de candado comparando Free vs Pro (`$199 MXN/mes`) y el botón *"Activar Pro"* con aviso de pago simulado que cambia `usuarios/{uid}.plan` a `"pro"`. 2) Los selectores de temporalidad (`1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`), los 28 activos agrupados por clase y las 6 estrategias crean documentos en `comandos` y el bot cambia su configuración en vivo. |
| **9** | **Órdenes desde la app: Long x10, Short x10, Cerrar posición, y que se muestre el resultado del bot** | **PARCIAL** | **Probado en navegador (`bot_panel_pro.png`):** al pulsar *Comprar / Long x10*, *Vender en corto / Short x10* o *Cerrar posición*, pide confirmación, crea el comando (`long`, `short`, `cerrar`) en `comandos/{id}`, escucha con `onSnapshot` y muestra el `resultado` devuelto por el bot junto con la operación en el portafolio del usuario (`$10,000 USD`). **Por qué es PARCIAL frente a `ESPECIFICACION.md` sección 5.4:** 1) La especificación pide *"Deshabilitar Long/Short si ya hay posición y Cerrar si no la hay"*, pero actualmente los 3 botones permanecen habilitados siempre (`disabled={ejecutandoOrdenApp}`) para permitir al usuario operar su propio saldo en cualquier momento. 2) La especificación pide mostrar en rojo cuando el bot devuelve *"ENTRADA BLOQUEADA POR RIESGO"*, pero si la compra en el saldo propio del usuario tiene éxito (`exitoCuentaUsuario = true`), el recuadro se pinta en verde (`ok`) aunque el bot en la VM haya bloqueado su entrada interna por CVaR. |
| **10** | **Espejo de Telegram en vivo** | **OK** | **Probado en navegador (`bot_panel_pro.png`):** lee los últimos 40 documentos de `telegram_espejo` ordenados por `ts` en tiempo real con auto-scroll al final. Muestra mensajes del bot a la izquierda y del usuario a la derecha, conserva saltos de línea y emojis, dibuja las filas de `botones` separados por ` \| ` como botones grises no clicables e incluye el punto verde activo cuando el último mensaje tiene menos de 2 minutos. |
| **11** | **Reporte Winrate y Test Diebold-Mariano** | **OK** | **Probado en navegador (`bot_reporte_winrate.png`):** 1) El botón *"🏆 Reporte Winrate"* lee `bot/winrate` en tiempo real y muestra winrate %, ganados/perdidos, PnL total, ROE promedio, ganancia/pérdida media, profit factor, caída máxima, mejor/peor trade, racha de 10 puntos verdes/rojos, tablas por estrategia/activo/lado y el aviso de *"Muestra pequeña"* cuando `n < 20`. 2) El botón *"🧪 Test Diebold-Mariano (RF)"* envía el comando `dm` y muestra `bot/dm` con el Bloque A (velas fuera de muestra), Bloque B (últimos trades reales con aviso cuando hay `< 8` trades) y la tabla `ultimas_predicciones` junto con el veredicto en una línea. |
| **12** | **Analista IA** | **OK** | **Probado en navegador (`analista_ia_vista.png`):** cuenta con el selector de los 3 modos de contexto (*Con mi portafolio*, *Con el estado del bot* `"BOT"` y *Pregunta libre* `""`), vista previa del contexto, las 3 preguntas sugeridas clicables e historial de chat conectado a `consultas/{id}`. También están conectados los botones *"✨ Analizar con IA"* del portafolio y *"✨ Analizar con Gemini"* del panel del bot. |
| **13** | **Videos de espera e introducción (si ya están)** | **FALLA** | **Verificado en sistema de archivos (`find . -iname "*.mp4"`):** aún no existen los archivos `espera.mp4` ni `intro.mp4` en el proyecto, ni su reproducción en `AuthScreen.jsx` / `App.jsx` (están marcados en `CONTEXTO_PARA_GEMINI.md` como paso posterior al Prompt 5). |

---

## C. Calidad y Seguridad

| # | Criterio | Estado | Evidencia de prueba y hallazgos |
|---|---|---|---|
| **14** | **Ninguna llave secreta en el frontend (busca en todo `app/`: Gemini, Telegram, Gate, JSON de credenciales)** | **OK** | **Escaneo completo con `grep -rnE` sobre `app/`:** `0` coincidencias de llaves de Gemini, Telegram, Gate.io o credenciales de servicio en `app/src/` y `app/index.html`. En `app/src/firebaseConfig.js` únicamente está el `firebaseConfig` público de cliente web permitido por la especificación. *(Advertencia de seguridad en backend: en `bot/bot_quant_x10_app.py` líneas 69–74 existen valores por defecto escritos dentro de `os.getenv(...)`; aunque no están en el frontend `app/`, se recomienda limpiarlos si el repositorio se sube a GitHub público).* |
| **15** | **`.gitignore` excluye `.env` y las credenciales** | **OK** | **Verificado en `/Users/macintoshhd/Downloads/kit_antigravity/.gitignore`:** el archivo existe en la raíz y excluye explícitamente `.env`, `firebase-credenciales.json`, `*-firebase-adminsdk-*.json`, `trading_bot.log*`, `__pycache__/`, `.firebase/` y `node_modules/`. |
| **16** | **`firestore.rules` desplegadas son las del proyecto** | **OK** | **Verificado con `diff -u` y API de Firebase Rules:** `/firestore.rules` y `/app/firestore.rules` son idénticos byte a byte y se encuentran desplegados en el proyecto `bolsalab-udem` (incluyendo las reglas de `usuarios`, `ranking`, `bot`, `mercado`, `trades_bot`, `telegram_espejo`, `comandos` y `consultas`). |
| **17** | **`npm run build` sin errores ni advertencias graves** | **OK** | **Probado con `npm --prefix app run build`:** compila exitosamente en `1.58 s` (`✓ 70 modules transformed`, `0` errores). Solo emite el aviso informativo estándar de Vite sobre el tamaño del bundle minificado (`938.27 kB` / `256.63 kB gzip`) por incluir `firebase` y `lightweight-charts`. |
| **18** | **Celular (`390 px`): sin scroll horizontal y todo legible** | **PARCIAL** | **Probado en navegador con viewport móvil `390 × 844` (`auditoria_movil_390px.png`):** en las 5 secciones `document.documentElement.scrollWidth` y `document.body.scrollWidth` miden exactamente `390 px` (no aparece barra de scroll horizontal global porque `body` tiene `overflow-x: hidden`). Sin embargo, en la inspección de cajas DOM en `390 px`, el contenedor `.dash-growth-panel` dentro de `.dashboard-charts-row` en `Mercado` no tiene `min-width: 0`, lo que hace que su ancho interno se recorte a la derecha en pantallas de `390 px`. Agregar `min-width: 0` a `.dash-growth-panel` y `.dash-breakdown-panel` lo corrige por completo. |
| **19** | **Errores en la consola del navegador** | **OK** | **Probado en navegador (`run_audit_browser.mjs`):** `0` errores en `console.error` (`consoleErrors: []`) y `0` excepciones no capturadas (`pageExceptions: []`) al registrarse, operar en Mercado, navegar por Juega y aprende, activar Pro en Bot de trading, abrir Modelo ML y consultar en Analista IA. |
| **20** | **Qué pasa si el bot está apagado: cada pantalla debe mostrar *"El bot aún no publica datos"* sin romperse** | **OK** | **Verificado en código y estados nulos:** 1) En `BotView.jsx` (líneas 452–460), si `bot/estado` es `null`, renderiza el panel *"El bot aún no publica datos"* sin lanzar excepciones; si `bot/velas`, `bot/winrate` o `bot/dm` son `null`, muestra el aviso correspondiente en cada subpanel. 2) En `ModeloMLView.jsx` (líneas 97–108), si `bot/validacion` es `null`, muestra *"El bot aún no publica datos"*. 3) En `MercadoView.jsx`, si un activo no tiene precio en `mercado/precios`, muestra `"sin precio"`, deshabilita el botón de orden y muestra la nota *"Las acciones y ETFs reciben precio del bot en la VM"*. |

---

## Resumen de Resultados

- **Total de puntos auditados:** 20
  - **OK:** **14** puntos (`1, 2, 3, 7, 8, 10, 11, 12, 14, 15, 16, 17, 19, 20`)
  - **PARCIAL:** **4** puntos (`4, 6, 9, 18`)
  - **FALLA:** **2** puntos (`5, 13`)

---

## Lista Priorizada para Arreglar antes de la Entrega del 17 de Noviembre

### Prioridad 1 — Obligatorio en la Rúbrica (Calificación Directa)
1. **Publicar la aplicación en Firebase Hosting (Punto 5 — FALLA):**
   - Ejecutar `npm --prefix app run build` y publicar el contenido de `app/dist` en Firebase Hosting (`firebase deploy --only hosting,firestore:rules`) para que `https://bolsalab-udem.web.app` abra públicamente sin error 404.
2. **Actualizar el nombre del modelo Gemini en el entorno del Bot (Punto 4 — PARCIAL):**
   - En el archivo `.env` de la máquina virtual / entorno donde corre `bot_quant_x10_app.py`, definir `GEMINI_MODEL=gemini-2.0-flash` (o `gemini-3.5-flash-lite`) para que el bot no caiga en el modelo deprecado `models/gemini-2.5-flash-lite` (`404 NOT_FOUND`) y responda directamente desde la API de Gemini.

### Prioridad 2 — Ajustes Funcionales y Visuales de la App
3. **Ajustar desbordamiento interno de `.dash-growth-panel` en móvil `390 px` (Punto 18 — PARCIAL):**
   - Añadir `min-width: 0;` a `.dash-growth-panel` y `.dash-breakdown-panel` en `app/src/index.css` para que el gráfico de crecimiento del portafolio se ajuste exactamente a `390 px` sin recortarse.
4. **Unificar el texto del toast de registro y criterio de saldo inicial (`$10,000` vs `$100,000`) (Punto 6 — PARCIAL):**
   - En `app/src/components/AuthScreen.jsx`, cambiar el texto del toast `"Cuenta creada con $100,000 USD virtuales"` a `"$10,000 USD virtuales"` (o confirmar si para la evaluación de la rúbrica se prefiere dejar `$10,000` o `$100,000`).
5. **Alinear estado de botones Long/Short/Cerrar en `BotView.jsx` si se evalúa literalmente la Sección 5.4 (Punto 9 — PARCIAL):**
   - Decidir si se mantiene el modo actual (botones siempre activos para operar con el saldo propio del usuario) o si se bloquean Long/Short cuando `estado.position != null` y se pinta en rojo cuando el bot en la VM bloquea por riesgo.
6. **Integrar los videos `espera.mp4` e `intro.mp4` si se incluirán en la entrega (Punto 13 — FALLA):**
   - Colocar `espera.mp4` e `intro.mp4` en `app/public/` y conectarlos en `AuthScreen.jsx` (fondo en bucle) y al iniciar sesión por primera vez.

---

## Riesgos para la Defensa en Vivo del 19 de Noviembre

1. **Doble instancia del bot en Spyder / VM escribiendo al mismo tiempo en Firestore:**
   - Durante las pruebas se observó que si se ejecuta el script del bot más de una vez en Spyder sin reiniciar el kernel, quedan hilos previos (`_fb_bucle_estado` y `_fb_escuchar`) sobrescribiendo `bot/estado` cada 30 s con distintos activos (`NVDA` vs `BTC_USDT`).
   - **Mitigación:** Antes de la defensa del 19 de noviembre, reiniciar el kernel de Spyder (o dejar corriendo únicamente una instancia limpia de `bot_quant_x10_app.py` en la VM).
2. **Caída o desconexión de la VM durante la demostración en vivo:**
   - Si la VM de Google Cloud se apaga o pierde red durante la defensa, las acciones/ETFs no recibirán actualizaciones en `mercado/precios` y los comandos `long`/`short`/`dm` harán timeout.
   - **Mitigación:** Las criptomonedas siguen cotizando en vivo desde el navegador vía WebSocket de Binance y el juego de Chartismo funciona 100% sin el bot, pero para demostrar el panel Pro en vivo conviene verificar `Último latido hace < 30 s` 10 minutos antes de iniciar la presentación.
3. **Bloqueo de entradas del bot en vivo por el filtro de riesgo (VaR / CVaR / CAViaR):**
   - Si durante la defensa hay alta volatilidad en el activo elegido (p. ej. `NVDA` con CVaR `6.79% > 2.20%`), el bot en la VM responderá `🔴 ENTRADA BLOQUEADA POR RIESGO`.
   - **Mitigación:** Cambiar desde el selector de la app a un activo/temporalidad con semáforo en verde (`🟢 Permitido`, p. ej. `BTC_USDT` en `1m` o `5m`) antes de demostrar la apertura de una posición en vivo.
4. **Llaves por defecto en `bot/bot_quant_x10_app.py` si el jurado revisa el código en un repositorio público:**
   - El frontend (`app/`) está 100% libre de llaves secretas, pero `bot/bot_quant_x10_app.py` (líneas 69–74) tiene llaves reales como segundo argumento de `os.getenv(...)`.
   - **Mitigación:** Mantener el repositorio privado o asegurar que el jurado revise `.env.example` y la arquitectura de variables de entorno.
