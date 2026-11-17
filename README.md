# BolsaLab — Bot Quant x10 & Terminal Financiera Cuantitativa

**BolsaLab** es una plataforma cuantitativa e interactiva que integra un **Bot de Trading Automatizado 24/7 en Google Cloud (Compute Engine VM)** conectado en tiempo real con **Telegram** y **Gate.io Futures Testnet**, junto con una **Aplicación Web en React** publicada en Firebase Hosting para gestión de portafolios con Machine Learning, validación estadística Diebold-Mariano y análisis con Gemini IA.

- **Aplicación web pública (URL activa):** https://bolsalab-udem.web.app
- **Guía de estudio y defensa oral:** [GUIA_ESTUDIO_Y_DEFENSA_BOT.md](GUIA_ESTUDIO_Y_DEFENSA_BOT.md)
- **Informe Técnico del Proyecto Final:** [INFORME_TECNICO_PROYECTO_FINAL.md](INFORME_TECNICO_PROYECTO_FINAL.md)

---

## Opciones del Proyecto Final Integrador implementadas (1, 2, 3 y 6)

- **Opción 1 — Clasificación de Riesgo de Inversión y Predicción de Volatilidad:** Clasifica cada activo en regímenes de volatilidad (`baja`, `media`, `alta` respecto a sus propios terciles históricos y mostrando volatilidad anual absoluta) en temporalidad diaria (`horizonte = 20 días`), comparando **Random Forest Classifier**, **KNN (Distancia Euclidiana ponderada por distancia)** y **Red Neuronal MLP** frente al modelo ingenuo mediante *Accuracy*, matriz de confusión 3×3, *F1-Score* macro/por clase y prueba **Diebold-Mariano (DM + p-valor)**.
- **Opción 2 — Optimización de Portafolios de Inversión (Markowitz / Regresión):** Predice rendimientos a 20 días con **Random Forest Regressor**, **KNN Regressor (Distancia Euclidiana)** y **Red Neuronal MLP**, validando con **RMSE**, **MSE**, **MAE**, **MAPE**, **SMAPE**, **Variance Score**, matriz de confusión direccional 2×2, **Diebold-Mariano** y **Matriz de Correlación de Pearson ($\rho_{ij}$)**. Construye la Frontera Eficiente de Markowitz y 5 carteras (*Recomendada según perfil*, *Máximo Sharpe*, *Mínima varianza*, *Paridad de riesgo* y *Pesos iguales 1/N*) con *Sharpe*, *Sortino*, *VaR/CVaR 95%* y prueba fuera de muestra frente al S&P 500 (`SPY`).
- **Opción 3 — Bot de Trading Automático en VM de Google Cloud + Telegram + Testnet:** Bot 24/7 bajo servicio `systemd` en Compute Engine (`Ubuntu` / `Python`) con consumo de datos reales de **Gate.io** y **Yahoo Finance**, señales técnicas (**Bandas de Bollinger 20, 2σ + filtro EMA 200**; más **Chartismo v3.2**, **Fibonacci + Abanicos + Gann**, **RSI 14**, **EMA 50/200** y **SuperTrend**), salidas por volatilidad **ATR(14)** (`TP 2.0 ATR / SL 0.4 ATR`, relación 5:1), apalancamiento dinámico `x10` / `x15` en `XRP` evaluado por **Random Forest**, semáforo de riesgo bloqueante (**CAViaR 99%**, **CVaR 99%**, **VaR 99%**), simulación de 8 configuraciones **Random Forest vs. CatBoost** con **Diebold-Mariano**, ejecución en **Gate.io Futures Testnet** y control total vía **Telegram**.
- **Opción 6 — Aplicación Financiera Interactiva con IA publicada en la Web:** Plataforma React + Vite + TradingView `lightweight-charts` publicada en `https://bolsalab-udem.web.app` con **Firebase Authentication** (correo y Google), terminal en vivo sincronizada por Firestore (`bot/estado`, `bot/velas`, `trades_bot`, `telegram_espejo`, `comandos`), asistente paso a paso de Portafolios con **Matriz de Correlación de Pearson**, simulador educativo interactivo (38 figuras chartistas) y **Analista IA** con **Google Gemini** y sentimiento en X con **xAI (Grok)**.

---

## Arquitectura del Sistema

```text
+-----------------------------------+        Firestore (tiempo real)        +-----------------------------------+
|  Bot Cuantitativo (GCP VM 24/7)   | ------------------------------------> |   Aplicación Web (Firebase Host)  |
|  vm/bot_trading.py (systemd)      |                                       |  https://bolsalab-udem.web.app    |
|                                   |  bot/estado, bot/velas, bot/analisis  |                                   |
|  - Gate.io Prod + Futures Testnet |  bot/validacion, trades_bot          |  - Terminal Bot + Espejo Telegram |
|  - Yahoo Finance (Stocks/ETFs)    |  mercado/precios, portafolios/{id}    |  - Estrategia Bot & Guía Defensa  |
|  - CAViaR 99% / CVaR 99% / VaR 99%|  telegram_espejo                      |  - Portafolio ML + Pearson + OOS  |
|  - RF vs CatBoost + Diebold-M.    | <------------------------------------ |  - Modelo ML (RF vs CatBoost)     |
|  - Telegram Bot + Gemini + Grok   |      comandos/{id}, consultas/{id}    |  - Analista IA + Auth + Mercado   |
+-----------------------------------+                                       +-----------------------------------+
```

---

## Cómo ejecutarlo localmente y en VM

### 1. Variables de entorno (`bot/.env.example`)

Copia `bot/.env.example` como `bot/.env` (**nunca** subas `.env` ni credenciales JSON a GitHub) y define:

- `TELEGRAM_BOT_TOKEN`
- `GEMINI_API_KEY`, `GEMINI_MODEL`
- `XAI_API_KEY`, `XAI_MODEL`
- `GATE_API_KEY`, `GATE_API_SECRET`
- `GATE_TESTNET_KEY`, `GATE_TESTNET_SECRET`, `GATE_TESTNET_HOST`
- `FIREBASE_CREDENTIALS` (ruta al JSON de cuenta de servicio de Firebase Admin SDK)

### 2. Bot cuantitativo en Python (`bot/` o `vm/`)

```bash
pip install numpy pandas matplotlib scikit-learn scipy gate-api google-genai \
  "python-telegram-bot>=21" python-dotenv openpyxl psutil firebase-admin catboost
python bot/bot_quant_x10_app.py --verificar
python bot/bot_quant_x10_app.py
```

### 3. Aplicación Web (`app/`)

```bash
cd app
npm install
npm run dev
```

Compilación y despliegue en Firebase Hosting:

```bash
cd app
npm run build
npx firebase-tools deploy --only hosting --project bolsalab-udem
```

---

## Estructura del Repositorio

- `app/` — Frontend React + Vite + Lightweight Charts + configuración de Firebase Hosting.
- `bot/` y `vm/` — Motor cuantitativo en Python, scripts de despliegue `systemd` en Google Cloud y plantilla `.env.example`.
- `GUIA_ESTUDIO_Y_DEFENSA_BOT.md` — Manual completo de funcionamiento interno, fórmulas de indicadores/riesgo/ML y respuestas de defensa oral.
- `INFORME_TECNICO_PROYECTO_FINAL.md` — Informe técnico formal con ecuaciones, simulaciones, validación Diebold-Mariano y evidencias.
- `firestore.rules` — Reglas de seguridad de Cloud Firestore.
