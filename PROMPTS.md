# Prompts para Antigravity (pégalos en este orden, uno por conversación terminada)

Antes de cada prompt escribe `/plan` para que primero te muestre el plan. Revísalo y dale **Proceed**.
No pegues el siguiente prompt hasta que el anterior funcione.

---
## Prompt 1 — Base, Firebase y acceso
```
/plan Lee completo @ESPECIFICACION.md. Vas a construir la app "BolsaLab" en esta carpeta, dentro de una
subcarpeta nueva llamada app/, con Vite + React.

En este primer paso haz SOLO esto:
1. Crea el proyecto en app/ e instala firebase y lightweight-charts.
2. Crea app/src/firebaseConfig.js con este firebaseConfig: [PEGA AQUÍ TU firebaseConfig]
3. Capa de datos con Firebase Auth y Firestore siguiendo EXACTAMENTE el contrato de la sección 3.
4. Pantalla de acceso (sección 5.1) y la estructura con la barra de navegación y las 5 secciones vacías.
5. Estilos globales según la sección 6.
6. Copia firestore.rules a app/ y crea app/firebase.json (hosting public: "dist").

No modifiques nada dentro de bot/ ni de datos/. Al terminar, levanta el servidor de desarrollo y dime la URL.
```
Prueba: crea una cuenta, sal y vuelve a entrar. En la consola de Firebase debe existir `usuarios/{uid}` con saldo 100000.

---
## Prompt 2 — Mercado (simulador)
```
/plan Siguiendo @ESPECIFICACION.md secciones 4 y 5.2, construye la sección Mercado: precios en vivo
(WebSocket de Binance para cripto y documento mercado/precios para acciones y ETFs), widget de TradingView,
boleta de orden, portafolio, historial y el ranking. Prueba tú mismo una compra y una venta en el navegador
y corrige lo que falle.
```
Prueba: compra BTC, vende la mitad, recarga la página: saldo, posición e historial siguen ahí.

---
## Prompt 3 — Juega y aprende
```
/plan Siguiendo @ESPECIFICACION.md sección 5.3, construye "Juega y aprende". Los datos están en
@datos/figuras_chartismo.json (cópialo a app/src/): son 38 figuras y lecturas, úsalas TODAS tal cual, sin
inventar ni quitar ninguna. NO uses imágenes: genera las velas con el algoritmo descrito y dibújalas con
lightweight-charts. Las imágenes de la carpeta referencias/ son solo para que veas cómo debe quedar cada
figura ya revelada (mira @referencias/00_lamina_1.png y @referencias/00_lamina_2.png). Implementa los 3 modos,
el revelado con líneas y flecha de ruptura, XP, niveles, racha y ranking.
```
Prueba: responde 5 rondas y abre la Biblioteca: deben aparecer las 38. Compara lo que dibuja contra las imágenes de `referencias/`.

---
## Prompt 4 — Bot de trading, operar desde la app, espejo de Telegram, reportes y Modelo ML
```
/plan Vuelve a leer @ESPECIFICACION.md: las secciones 3 y 5.4 se actualizaron. Construye el panel del bot
(sección 5.4, con candado Free/Pro y pago simulado) y la pestaña Modelo ML (sección 5.5). Incluye TODO lo de
5.4: indicadores, gráfico con la posición, controles, y además:
1. Operar desde la app: botones Long x10, Short x10 y Cerrar posición, que crean comandos y muestran el
   resultado que devuelve el bot.
2. "Telegram en vivo": espejo del chat de Telegram leyendo la colección telegram_espejo en tiempo real.
3. Botón "Reporte Winrate" (documento bot/winrate).
4. Botón "Test Diebold-Mariano (RF)" (comando dm y documento bot/dm).
Todo se lee de Firestore con onSnapshot. Si un documento todavía no existe, muestra "El bot aún no publica
datos" sin romper la pantalla.
El archivo @firestore.rules de la raíz cambió: cópialo otra vez a app/ y despliégalo con
firebase deploy --only firestore:rules. No modifiques nada dentro de bot/.
```
Prueba (con el bot encendido y tu cuenta en Pro):
- Pulsa Long x10 en la app: debe llegarte el mensaje "ORDEN DESDE LA APP WEB" en Telegram y verse en el espejo.
- Toca cualquier botón en Telegram: debe aparecer en el espejo de la app en 1–2 segundos.
- Cierra la posición desde la app y abre "Reporte Winrate": el trade debe contar.
- Pulsa "Test Diebold-Mariano": en ~1 minuto aparece el reporte.

---
## Prompt 5 — Analista IA
```
/plan Siguiendo @ESPECIFICACION.md secciones 3 (consultas) y 5.6, construye el Analista IA y conecta los
botones "Analizar con IA" del portafolio y "Analizar con Gemini" del panel del bot. La app nunca llama a
Gemini directo: crea el documento en consultas y espera la respuesta del bot.
```

---
## Prompt 6 — Revisión y publicación
```
/plan Revisa la app contra la sección 7 de @ESPECIFICACION.md punto por punto y corrige lo que no se cumpla.
Verifica que en celular (390 px) no haya scroll horizontal. Luego ejecuta npm run build y publica con
firebase deploy --only hosting,firestore:rules (si pide iniciar sesión, dime qué comando correr). Crea un
README.md con la arquitectura y un .gitignore que excluya .env y cualquier JSON de credenciales. Dame la URL pública.
```
