# INFORME DE ESTADO — BolsaLab

**Fecha de auditoría:** 2026-11-14 (22:17–22:26 CST)  
**Repositorio:** `/Users/macintoshhd/Downloads/kit_antigravity`  
**Alcance:** Auditoría sin modificaciones de código ni alteración de cuentas reales (se usaron usuarios temporales eliminados al concluir).

---

## 1. Resumen ejecutivo

BolsaLab se encuentra **operativo a nivel funcional completo en entorno local** (`vite build` compila limpio en 1.33 s y los 21 comandos seguros probados contra el bot de Python ejecutado localmente en Spyder respondieron `"hecho"` sin errores JS ni de permisos en consola). El flujo cuantitativo de extremo a extremo —simulador de Mercado, Trading (bot) con Centro de resultados, Portafolio Markowitz/ML, Aprender, Modelo ML y Analista IA con Gemini— está conectado y vivo vía Firestore.

**Los 3 problemas más graves detectados:**
1. **Sin URL pública desplegada (`FALTA` en rúbrica):** `https://bolsalab-udem.web.app` devuelve **HTTP 404 (`Site Not Found`)** y `firebase.json` solo configura `"firestore"`, sin sección `"hosting"`.
2. **Vista independiente `MisPosicionesView` inaccesible y limpieza pendiente de suscripciones heredadas:** `App.jsx` conserva `seccionActiva === 'posiciones'`, pero `Navbar.jsx` y `MercadoView.jsx` no tienen enlace para abrirla; además `BotView.jsx` escucha `bot/winrate` y `bot/dm` cuyos estados (`winrateDoc`, `dmDoc`) no se renderizan, mientras `bot/analisis_grafico` y `bot/sentimiento` publicados por el bot no se leen directamente en `app/src/`.
3. **Controles de Bot y Portafolio con fricción menor / funciones opcionales faltantes:** No existe interruptor visible en UI para pausar/activar `botAutoCopiar` (Cuenta Espejo) ni botón de análisis Gemini directo dentro de `ModeloMLView.jsx` (Gemini sí funciona en `AnalistaIAView`, `PortafolioMLView` y `ACT:GEMINI` del bot). En `BotView`, las herramientas laterales de dibujo en pantalla mostraron `drawTools: 0` bajo ese selector y en esta corrida no se validó `long`/`short`/`cerrar` por existir posición abierta activa en el bot.

---

## 2. Estado pestaña por pestaña

| Pestaña / Flujo | Función | Estado | Evidencia (acción realizada y resultado observado) |
| :--- | :--- | :--- | :--- |
| **Login (`AuthScreen.jsx`)** | Login correo/contraseña y mensajes de error | **OK** | En prueba con contraseña incorrecta mostró `"Correo o contraseña incorrectos. Verifica tus datos."`. Con credenciales válidas autenticó y cargó la app. |
| **Login (`AuthScreen.jsx`)** | Registro de nueva cuenta | **NO PROBADO** | Tab `"Crear cuenta"` presente en DOM (`hasRegisterTab: true`); se crearon cuentas vía Firebase Admin SDK para aislar pruebas. |
| **Login (`AuthScreen.jsx`)** | Inicio de sesión con Google | **NO PROBADO** | Botón de Google detectado en DOM (`hasGoogleBtn: true`); el popup OAuth interactivo no es automatizable en Chrome headless. |
| **Onboarding (`OnboardingModal.jsx`)** | Flujo multipaso y persistencia en Firestore | **OK** | Probado con usuario temporal (`onboarding_ok: false`): seleccionó `largo_plazo` → `algo` → 3 respuestas de riesgo → `"Ver mi plan recomendado →"` → `"Ir ahora a Portafolio →"`. El modal cerró y guardó `onboarding_ok: true`, `perfil_riesgo: "moderado"`. |
| **Mercado (`MercadoView.jsx`)** | Gráfica TradingView en vivo + cambio de activo | **OK** | Cargó `iframe` del widget TradingView, 8 mini-cards de mercado y texto dinámico `"Si baja ... / Si sube ..."`. |
| **Mercado (`MercadoView.jsx`)** | Compra simulada + cierre + tabla `Cerradas hoy` | **OK** | Se pulsó comprar BTC (`$500`), actualizó el tab a `"Mis posiciones (1)"`, abrió modal `Cerrar`, confirmó cierre y registró 1 fila en `"Cerradas hoy"`. |
| **Mis posiciones (`MisPosicionesView.jsx`)** | Panel integrado dentro de `Mercado` vs. ruta propia `'posiciones'` | **PARCIAL** | Las posiciones abiertas, cerradas hoy e historial funcionan dentro de `MercadoView.jsx`. Sin embargo, la pantalla independiente `MisPosicionesView.jsx` (`seccionActiva === 'posiciones'` en `App.jsx`) no tiene botón ni enlace en `Navbar.jsx` ni en `MercadoView.jsx`. |
| **Trading (bot) (`BotView.jsx`)** | Estado del bot, velas `lightweight-charts` y chat espejo | **OK** | Mostró `"Bot en línea"`, 7 `<canvas>`, 8 burbujas y 2 miniaturas PNG en `Telegram en vivo`, más las 5 pestañas inferiores (`Posición del bot (1)`, `Resultados`, `Operaciones del bot`, `Cuenta del bot (simulada)`, `Riesgo VaR/CVaR/CAViaR`). |
| **Trading (bot) (`CentroResultadosBot.jsx`)** | Centro de resultados (agrupamiento PNG+texto, filtros, modal) | **OK** | Tras corregir filtro de menú en cuerpo, **Reporte** (`1404×936`), **Sentimiento** (`1404×1188`, aviso `"El sentimiento tarda hasta 60 s."`, 39 líneas con *Ver menos/Ver más*), **Win rate** (11 líneas) y modal **Descargar PNG** funcionaron en vivo con apertura automática. |
| **Trading (bot) (`BotView.jsx`)** | Botones de dibujo lateral del gráfico | **NO PROBADO** | `drawTools` bajo selector `.bot-draw-btn` devolvió `0`; no se trazaron líneas sobre el canvas de `BotCandlesChart` en esta corrida. |
| **Portafolio (`PortafolioMLView.jsx`)** | Optimización Markowitz/ML + Frontera + Donas + 5.7 bis | **OK** | Al pulsar **Calcular**, el comando `portafolio` tardó **20.5 s** en devolver las 5 tarjetas de cartera, 4 `<svg>`, paso a paso, fuera de muestra y tablas Opción 1 y Opción 2 (incluyendo MAPE, SMAPE y VAR. SCORE). |
| **Portafolio (`PortafolioMLView.jsx`)** | Botón `"Explicar con IA"` (Gemini vía `consultas`) | **OK** | Respondió en **16.6 s** con explicación en español sobre el portafolio calculado y advertencia de simulación. |
| **Aprender (`JuegoView.jsx`)** | Canvas de velas, 4 opciones, XP y Ranking | **OK** | Cargó `<canvas>`, 4 opciones (`.btn-opcion`), marcador `XP`, ranking y mostró retroalimentación al responder. |
| **Aprender (`JuegoView.jsx`)** | Herramientas de dibujo y calificación automática | **PARCIAL** | Los 4 botones (`Línea de tendencia`, `Línea horizontal`, `Deshacer`, `Borrar todo`) existen y permiten dibujar; en el clic horizontal probado en headless no apareció texto `"Bien trazada"` / `"Revisa"` tras contestar la ronda (`hasDrawFeedback: false`). |
| **Modelo ML (`ModeloMLView.jsx`)** | Héroe, Matriz confusión, 6 filas RF/CatBoost y métricas | **OK** | Mostró `"¿Qué tan bueno es el modelo?"`, Matriz de confusión, Por clase, Random Forest vs CatBoost, Gráfica comparativa y tabla de 6 filas con `RMSE, MSE, MAE, MAPE, SMAPE, VAR. SCORE, ACC., F1, DM, P` + botón Recalcular. |
| **Modelo ML (`ModeloMLView.jsx`)** | Botón de explicación Gemini en la pestaña ML | **NO EXISTE** | `hasGeminiBtn: false`; la pestaña no incluye botón propio de IA (Gemini vive en `Analista IA`, `Portafolio` y `ACT:GEMINI`). |
| **Analista IA (`AnalistaIAView.jsx`)** | Preguntas con contexto y respuesta Gemini vía `consultas` | **OK** | Al seleccionar contexto y sugerencia envió documento a `consultas` (`doc: rKntyH`) y recibió respuesta completa de Gemini en **10.5 s**. |
| **Ajustes (`AjustesModal.jsx`)** | Tamaño de copia y borrado de historial | **OK** | Abierto desde `button[aria-label="Ajustes"]`: cambió `botTamanoCopia` a `"5"` y `"Borrar historial de prueba"` restauró `saldo` de `$9,500` a `$10,000` en Firestore. |
| **Ajustes (`AjustesModal.jsx`)** | Interruptor `Auto-copiar` (`botAutoCopiar`) en UI | **NO EXISTE** | No hay botón en `AjustesModal` ni en `BotView` para activar/pausar `botAutoCopiar` (`App.jsx` ejecuta copia espejo automática cuando el bot abre/cierra). |

---

## 3. Conexión con el bot y documentos de Firestore

Medición realizada el **2026-11-14 a las 22:17 CST** (`now_ms = 1794716243000`):

| Documento / Colección | ¿La app lo lee? | Archivo / Pantalla que lo usa | Antigüedad del último dato (medida) | Observaciones |
| :--- | :--- | :--- | :--- | :--- |
| `bot/estado` | **Sí** | `App.jsx`, `Navbar.jsx`, `BotView.jsx`, `MercadoView.jsx`, `MisPosicionesView.jsx`, `AnalistaIAView.jsx` | **7.5 s** (`ts: 1794716235.88`) | Vivo. `trading_enabled: true`, `position: LONG BTC_USDT`. |
| `bot/velas` | **Sí** | `BotView.jsx` → `BotCandlesChart.jsx` | **Sin campo `ts`** (última vela `t: 1794716160`, ~1 min) | 300 velas de `BTC_USDT` `1m`. |
| `bot/analisis` | **Sí** | `App.jsx`, `MercadoView.jsx`, `BotView.jsx` | **201.7 s** (en lectura base; se actualiza en vivo al pedir `analisis`) | Incluye `niveles`, `lineas`, `zonas`, `marcadores`, `resumen`. |
| `bot/analisis_grafico` | **No** | Ninguno en `app/src/` | **200.8 s** | El bot lo publica en Firestore, pero el frontend solo lee `bot/analisis`. |
| `bot/validacion` | **Sí** | `ModeloMLView.jsx` | **1,256.9 s (~21 min)** | Contiene `tabla` (6 configs RF/CatBoost), `matriz`, `veredicto`. |
| `bot/winrate` | **Suscrito sin uso en JSX** | `BotView.jsx` (`winrateDoc` no se renderiza) | **364.8 s (~6 min)** | Antes lo usaba `TelegramMenuPanel.jsx`; hoy se muestra vía `telegram_espejo` (`ACT:WINRATE`). |
| `bot/dm` | **Suscrito sin uso en JSX** | `BotView.jsx` (`dmDoc` no se renderiza) | **1,256.6 s (~21 min)** | `ModeloMLView` usa `bot/validacion`; Bot muestra DM vía `telegram_espejo` (`ACT:DM`). |
| `bot/menu` | **No en vista activa** | Helper `escucharBotMenu` en `firebase.js` (solo `TelegramMenuPanel.jsx` heredado) | **7.1 s** | Vivo en Firestore, pero `BotView.jsx` usa botones fijos propios. |
| `bot/sentimiento` | **No** | Ninguno en `app/src/` | **324.9 s (~5.4 min)** | La app muestra el sentimiento vía documentos de `telegram_espejo`. |
| `mercado/precios` | **Sí** | `App.jsx` → todas las vistas de trading/portafolio | **52.0 s** | Precios vivos de cripto, acciones y ETFs. |
| `telegram_espejo` | **Sí** | `BotView.jsx` → `CentroResultadosBot.jsx` y `Telegram en vivo` | **199.1 s** base / en vivo al consultar | Últimos 50 documentos ordenados por `ts`. |
| `trades_bot` | **Sí** | `App.jsx`, `BotView.jsx`, `MisPosicionesView.jsx` | **14,660.4 s (~4.1 h)** | Historial de operaciones cerradas del bot. |
| `comandos` | **Sí (RW)** | `firebase.js` (usado por `BotView`, `PortafolioMLView`, `ModeloMLView`, `App.jsx`) | **203.5 s** base / en vivo (<1 s a 65 s) | Cola app → bot; el bot actualiza `estado: 'hecho'`. |
| `consultas` | **Sí (RW)** | `firebase.js` → `AnalistaIAView.jsx`, `PortafolioMLView.jsx` | **197,359 s** previos / **10.5 s** en prueba viva | Cola Gemini app → bot; el bot responde `estado: 'lista'`. |
| `portafolios` | **Sí** | `PortafolioMLView.jsx` (`portafolios/{id}`) | **15,299 s** previos / **20.5 s** en prueba viva | Guardado por bot tras comando `portafolio`. |

---

## 4. Prueba de comandos (`comandos` → bot Python)

Estado previo del bot en Firestore: `trading_enabled = True`, `asset = BTC_USDT`, `timeframe = 1m`, `strategy = CHARTISMO`, **`position = LONG BTC_USDT` abierta**. Todos los cambios temporales de configuración (`tf`, `estrategia`, `activo`, `toggle`) fueron restaurados inmediatamente al estado original.

| Comando / Valor | ¿Llegó a `hecho`? | Tiempo | Resultado devuelto |
| :--- | :--- | :--- | :--- |
| `analisis` | **Sí (`hecho`)** | 5,304 ms | `✅ Análisis 6° Chartismo+Ruptura publicado` |
| `tf` → `'5m'` (y restauración `'1m'`) | **Sí (`hecho`)** | 322 ms / 688 ms | `✅ Temporalidad cambiada a 5 min` → `1 min` |
| `estrategia` → `'RSI'` (y restauración `'CHARTISMO'`) | **Sí (`hecho`)** | 615 ms / 268 ms | `✅ Estrategia: 1° RSI Spot/Fut` → `6° Chartismo+Ruptura` |
| `activo` → `'ETH_USDT'` (y restauración `'BTC_USDT'` + `'CHARTISMO'`) | **Sí (`hecho`)** | 679 ms / 695 ms | `✅ Activo cambiado a ETH_USDT` → `BTC_USDT` |
| `toggle` (pausar y reactivar Auto-Trading) | **Sí (`hecho`)** | 756 ms / 1,035 ms | `Auto-Trading PAUSADO 🔴` → `Auto-Trading ENCENDIDO 🟢` |
| `portafolio` (vía botón **Calcular** en UI) | **Sí (`hecho`)** | 20,543 ms | Escribió `portafolios/{id}` con 5 carteras, frontera y validación 5.7 bis |
| `telegram` → `MENU:TF` | **Sí (`hecho`)** | 277 ms | `Elige la temporalidad:` |
| `telegram` → `MENU:STRAT` | **Sí (`hecho`)** | 579 ms | Menú `TERMINAL QUANT x10` actualizado |
| `telegram` → `MENU:ASSETS` | **Sí (`hecho`)** | 263 ms | Menú `TERMINAL QUANT x10` actualizado |
| `telegram` → `ACT:REFRESH_RISK` | **Sí (`hecho`)** | 2,040 ms | `Actualizando métricas de riesgo...` |
| `telegram` → `ACT:BALANCE` | **Sí (`hecho`)** | 1,757 ms | `━━━ 💼 CARTERA QUANT x10 ━━━ \| Capital Disponible: $995.18...` |
| `telegram` → `ACT:TRADES` | **Sí (`hecho`)** | 663 ms | `━━━ 📜 ÚLTIMAS 8 OPERACIONES ━━━ ...` |
| `telegram` → `ACT:WINRATE` | **Sí (`hecho`)** | 977 ms | `━━━ 🏆 ESTADÍSTICAS WINRATE (32 TRADES) ━━━ ... Acierto: 40.6%` |
| `telegram` → `ACT:DM` | **Sí (`hecho`)** | 3,146 ms | `━━━ 🧪 TEST DIEBOLD-MARIANO (RF) ━━━ ... (171 velas, h=6)` |
| `telegram` → `ACT:REPORT_CHART` | **Sí (`hecho`)** | 3,415 ms | `📊 Gráfico generado` + `━━━ 📊 REPORTE QUANT x10 ━━━` |
| `telegram` → `ACT:GROK_SENTIMENT` | **Sí (`hecho`)** | 64,823 ms | Válvula Grok PNG + `━━━ 🧭 INTELIGENCIA DE SENTIMIENTO EN X (GROK) ━━━` |
| `telegram` → `ACT:EXCEL` | **Sí (`hecho`)** | 3,035 ms | `📁 Archivo generado: Quant_x10_BTC_USDT_1m_20261115_042328.xlsx` |
| `telegram` → `ACT:GEMINI` | **Sí (`hecho`)** | 18,876 ms | `━━━ 🧠 DICTAMEN IA GEMINI (BTC_USDT) ━━━ ...` |
| `long` / `short` / `cerrar` (y `ACT:BUY_LONG`, `ACT:CLOSE_OR_SHORT`) | **NO PROBADO** | — | Omitido por seguridad: `bot/estado` tenía posición activa (`LONG BTC_USDT @ $64,785.10`) y `trading_enabled: true`. |

---

## 5. Errores de consola y permisos

- **Errores de consola JS (`console.error` / `Runtime.exceptionThrown`):** **0 errores** en todas las corridas en vivo (`CONSOLE_ERRORS: []`, `pageErrors: []`).
- **Errores `"Missing or insufficient permissions"`:** **0 ocurrencias** con usuarios de prueba durante el recorrido de Login, Onboarding, Mercado, Trading (bot), Portafolio, Aprender, Modelo ML, Analista IA y Ajustes.
- *Nota sobre reglas:* `firestore.rules` tiene temporalmente `function esPro() { return true; }` (línea 6). Si se reactiva la línea 7 (`data.plan == 'pro'`) para cobrar, un usuario con `plan != 'pro'` que intente leer `telegram_espejo` o enviar comandos fuera de `['portafolio', 'analisis']` recibiría error de permisos — actualmente el frontend lo bloquea con `PRO_GRATIS = true` en `planConfig.js`, así que ambas banderas están alineadas.

---

## 6. Reglas de Firestore (`firestore.rules`)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function logueado() { return request.auth != null; }
    // VERSION PRELIMINAR: el bot es gratis para todos. Para volver a cobrar, cambia true por la linea comentada.
    function esPro() { return true; }
    // function esPro() { return get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.plan == 'pro'; }

    match /usuarios/{uid}/{doc=**} { allow read, write: if logueado() && request.auth.uid == uid; }
    match /ranking/{uid} { allow read: if logueado(); allow write: if logueado() && request.auth.uid == uid; }
    // Lo escribe solo el bot (Admin SDK, se salta estas reglas)
    match /bot/{doc} { allow read: if logueado(); }
    match /mercado/{doc} { allow read: if logueado(); }
    match /trades_bot/{doc} { allow read: if logueado(); }
    // La app pide; el bot responde
    match /telegram_espejo/{doc} { allow read: if logueado() && esPro(); }
    match /comandos/{doc} {
      allow create: if logueado() && request.resource.data.uid == request.auth.uid
                    && (esPro() || request.resource.data.tipo in ['portafolio', 'analisis']);
      allow read: if logueado() && resource.data.uid == request.auth.uid;
    }
    // Lo escribe el bot (Admin SDK) con el resultado de Markowitz para cada usuario
    match /portafolios/{doc} { allow read: if logueado() && resource.data.uid == request.auth.uid; }
    match /consultas/{doc} {
      allow create: if logueado() && request.resource.data.uid == request.auth.uid;
      allow read: if logueado() && resource.data.uid == request.auth.uid;
    }
  }
}
```

**Cobertura:** **Sí**, cubre todas las colecciones y subcolecciones que usa la app (`usuarios/{uid}`, `usuarios/{uid}/ordenes`, `ranking`, `bot/{doc}`, `mercado/{doc}`, `trades_bot`, `telegram_espejo`, `comandos`, `portafolios`, `consultas`).

---

## 7. Checklist de rúbrica — Opción 6

| Requisito Opción 6 | Estado | Detalle observado |
| :--- | :--- | :--- |
| Firebase Auth | **OK** | Email/contraseña, registro y botón Google implementados en `AuthScreen.jsx`. |
| Motor cuantitativo | **OK** | 6 estrategias en vivo, VaR/CVaR/CAViaR, Markowitz, Paridad de Riesgo y prueba fuera de muestra activos desde Python local (Spyder). |
| Métricas ML en pantalla (`RMSE, MSE, MAE, MAPE, SMAPE, Variance Score, matriz/F1, Diebold-Mariano`) | **OK** | Todas presentes en `ModeloMLView.jsx` (tabla de 6 filas + matriz de confusión + DM) y en `PortafolioMLView.jsx` sección 5.7 bis (Opción 1 y Opción 2). |
| Análisis con Gemini | **OK** | Operativo vía `consultas` en `AnalistaIAView.jsx` (10.5 s), `PortafolioMLView.jsx` (*Explicar con IA*, 16.6 s) y Bot `ACT:GEMINI` (18.9 s). *(Solo falta botón directo dentro de `ModeloMLView.jsx`, si se deseara ahí).* |
| Panel del bot conectado | **OK** | Estado en línea desde Python local (Spyder), velas, señal, controles y Centro de resultados funcionando en `BotView.jsx`. |
| URL pública | **FALTA** | `https://bolsalab-udem.web.app` existe como sitio en Firebase Hosting pero devuelve **HTTP 404**; `firebase.json` no tiene configuración de `hosting`. |

---

## 8. Seguridad y secretos

- **Código frontend (`app/src/`) y repositorio rastreado (`git ls-files`):** **Sin llaves privadas de servidor.**
- **`.gitignore`:** Incluye `.env`, `firebase-credenciales.json`, `*-firebase-adminsdk-*.json`, `trading_bot.log*`, `__pycache__/`, `.firebase/`, `node_modules/`. Se verificó con `git ls-files` que ni `bot/.env` ni `bot/firebase-credenciales.json` están rastreados por Git (`tracked=False`). *(Nota: `bot/.env.example` sí está rastreado como plantilla sin credenciales reales).*
- **Llaves encontradas (solo los primeros 6 caracteres):**
  - `app/src/firebaseConfig.js` (identificador público cliente Web de Firebase — no secreto de servidor):
    - Firebase Web API Key: `AIzaSy` (`len=39`)
  - `bot/.env` (solo entorno local en Spyder, **no rastreado en Git**):
    - `TELEGRAM_BOT_TOKEN`: `857594` (`len=46`)
    - `GEMINI_API_KEY`: `AQ.Ab8` (`len=53`)
    - `GEMINI_MODEL`: `gemini` (`len=16`)
    - `GATE_API_KEY`: `d207a4` (`len=32`)
    - `GATE_API_SECRET`: `fb9ef8` (`len=64`)
    - `FIREBASE_CREDENTIALS`: `fireba` (`len=26`)
  - `bot/firebase-credenciales.json` (solo entorno local en Spyder, **no rastreado en Git**): credencial JSON de Service Account de Firebase Admin SDK.

---

## 9. Despliegue y compilación

- **`npm --prefix app run build`:** **Pasa** sin errores (`✓ 2148 modules transformed.`, `✓ built in 1.33s`).
- **Tamaño del build (`app/dist`):** **`1.1M`** en disco:
  - `dist/index.html`: `0.73 kB` (`gzip: 0.42 kB`)
  - `dist/assets/index-D3t2spB2.css`: `102.28 kB` (`gzip: 17.66 kB`)
  - `dist/assets/index-CHRRanjO.js`: `1,044.25 kB` (`gzip: 285.60 kB`) — *aviso de Vite por chunk > 500 kB*.
- **URL pública:** El sitio `https://bolsalab-udem.web.app` está registrado en Firebase Hosting pero **no tiene deploy publicado** (responde **HTTP 404 `Site Not Found`**).

---

## 10. Pendientes ordenados por prioridad

| Prioridad | Pendiente | Archivo(s) a corregir | Tiempo estimado |
| :---: | :--- | :--- | :---: |
| **1 (Alta)** | Configurar `hosting` en Firebase (`public: "app/dist"`, rewrite SPA) y ejecutar `firebase deploy --only hosting` para habilitar `https://bolsalab-udem.web.app` para la rúbrica. | `/Users/macintoshhd/Downloads/kit_antigravity/firebase.json` | 15 min |
| **2 (Media)** | Definir ruta/navegación hacia `MisPosicionesView` (agregar botón `"Ver historial completo"` desde `MercadoView` o limpiarla si ya quedó reemplazada por la tabla inferior). | `app/src/components/MercadoView.jsx` o `app/src/components/Navbar.jsx` / `app/src/App.jsx` | 20 min |
| **3 (Media)** | Revisar e integrar o retirar suscripciones sin uso en `BotView.jsx` (`bot/winrate` → `winrateDoc`, `bot/dm` → `dmDoc`) y valorar lectura directa de `bot/analisis_grafico` / `bot/sentimiento` para reducir latencia inicial. | `app/src/components/BotView.jsx`, `app/src/components/CentroResultadosBot.jsx` | 30 min |
| **4 (Baja)** | Agregar interruptor visible en `AjustesModal.jsx` para activar/desactivar `botAutoCopiar` (actualmente siempre activo en `App.jsx` sin toggle en UI). | `app/src/components/AjustesModal.jsx`, `app/src/App.jsx` | 20 min |
| **5 (Baja)** | Verificar manualmente en navegador la evaluación de dibujo en `JuegoView.jsx` (2 clics tendencia / horizontal vs líneas de referencia) y, si se desea para UX, agregar botón opcional de Gemini en `ModeloMLView.jsx` y code-splitting para bajar el bundle JS (< 500 kB). | `app/src/components/JuegoView.jsx`, `app/src/components/ModeloMLView.jsx`, `app/vite.config.js` | 40 min |
