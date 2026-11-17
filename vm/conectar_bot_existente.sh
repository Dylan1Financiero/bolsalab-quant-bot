#!/usr/bin/env bash
# =====================================================================
#  BolsaLab · conecta el bot que YA corre en esta VM con la página web
#  Conserva su token de Telegram y sus llaves. Solo:
#    1) guarda sus llaves en .env (si estaban escritas en el código)
#    2) pone el bot actualizado (bot_trading.py, sin llaves en el código)
#    3) pone la credencial de Firebase del proyecto bolsalab-udem
#    4) reinicia el servicio y verifica
#  Uso:  bash conectar_bot_existente.sh            (carpeta ~/bot_quant)
#        bash conectar_bot_existente.sh /ruta/del/bot   (si está en otra carpeta)
#  Archivos que deben estar en tu home: bot_trading.py  firebase-credenciales.json
# =====================================================================
set -euo pipefail
APP="${1:-$HOME/bot_quant}"
SERVICIO="bot-quant"
STAMP=$(date +%Y%m%d_%H%M%S)

echo "[1/7] Buscando el bot en $APP"
[ -d "$APP" ] || { echo "No existe $APP. Corre: bash conectar_bot_existente.sh /ruta/de/la/carpeta/del/bot"; exit 1; }
VIEJO=$(ls "$APP"/*.py 2>/dev/null | grep -v -E 'respaldo|reproducir|verificar' | head -1 || true)
[ -n "$VIEJO" ] || { echo "No encontré el .py del bot en $APP"; exit 1; }
echo "      Bot actual: $VIEJO"
for f in bot_trading.py firebase-credenciales.json; do
  [ -f "$HOME/$f" ] || { echo "FALTA ~/$f · súbelo con 'Subir archivo' y vuelve a correr"; exit 1; }
done
PY="$APP/venv/bin/python"; [ -x "$PY" ] || PY=python3

echo "[2/7] Deteniendo el bot"
sudo systemctl stop "$SERVICIO" 2>/dev/null || true
pkill -f "python.*$(basename "$VIEJO")" 2>/dev/null || true
sleep 2

echo "[3/7] Respaldo de la versión actual"
cp "$VIEJO" "$VIEJO.respaldo_$STAMP"
[ -f "$APP/.env" ] && cp "$APP/.env" "$APP/.env.respaldo_$STAMP"
touch "$APP/.env"

echo "[4/7] Pasando al .env las llaves que estaban escritas en el código (sin mostrarlas)"
"$PY" - "$VIEJO" "$APP/.env" <<'PYEOF'
import re, sys
src = open(sys.argv[1], encoding='utf-8', errors='ignore').read()
envp = sys.argv[2]
env = open(envp, encoding='utf-8').read()
tiene = {l.split('=', 1)[0].strip() for l in env.splitlines() if '=' in l and not l.lstrip().startswith('#')}
claves = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'GATE_API_KEY', 'GATE_API_SECRET', 'GATE_TESTNET_KEY',
          'GATE_TESTNET_SECRET', 'GATE_TESTNET_HOST', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'XAI_API_KEY', 'XAI_MODEL']
nuevas = []
for k in claves:
    if k in tiene:
        continue
    m = re.search(r"^%s\s*=\s*os\.getenv\(\s*['\"]%s['\"]\s*,\s*['\"]([^'\"]+)['\"]" % (k, k), src, re.M)
    if m:
        nuevas.append('%s=%s' % (k, m.group(1)))
# la credencial de Firebase va junto al bot: se quita cualquier ruta vieja
lineas = [l for l in env.splitlines() if not l.startswith('FIREBASE_CREDENTIALS=')]
if not any(l.startswith('BOT_ORIGEN=') for l in lineas):
    lineas.append('BOT_ORIGEN=VM Google Cloud')
lineas += nuevas
open(envp, 'w', encoding='utf-8').write('\n'.join(lineas).strip() + '\n')
print('      Llaves copiadas del código al .env:', [n.split('=')[0] for n in nuevas] or 'ninguna (ya estaban en .env)')
faltan = [k for k in ('TELEGRAM_BOT_TOKEN', 'GATE_TESTNET_KEY', 'GATE_TESTNET_SECRET', 'GEMINI_API_KEY')
          if k not in tiene and not any(n.startswith(k + '=') for n in nuevas)]
if faltan:
    print('      AVISO: no encontré', faltan, '· agrégalas con: nano', envp)
PYEOF
chmod 600 "$APP/.env"

echo "[5/7] Instalando el bot actualizado y la credencial de Firebase"
mv -f "$HOME/bot_trading.py" "$VIEJO"
mv -f "$HOME/firebase-credenciales.json" "$APP/firebase-credenciales.json"
chmod 600 "$APP/firebase-credenciales.json"
"$PY" -m pip install --quiet firebase-admin python-dotenv requests || true

echo "[6/7] Verificación (llaves, testnet, Firebase, Gemini)"
cd "$APP"
"$PY" "$VIEJO" --verificar || echo "      Revisa arriba los puntos con error."

echo "[7/7] Reiniciando el servicio"
if systemctl list-unit-files 2>/dev/null | grep -q "^$SERVICIO.service"; then
  sudo systemctl restart "$SERVICIO"; sleep 10
  sudo systemctl status "$SERVICIO" --no-pager | head -6
else
  nohup "$PY" -u "$VIEJO" > "$APP/salida_bot.log" 2>&1 &
  echo "      No hay servicio systemd; el bot quedó corriendo en segundo plano (PID $!)."
  echo "      Para dejarlo 24/7 con systemd usa: bash instalar_vm.sh"
  sleep 10
fi
echo
echo "Últimas líneas de Firebase en el log:"
grep -i -E "firebase|firestore" "$APP/trading_bot.log" 2>/dev/null | tail -5 || echo "  (aún no hay líneas; espera 1 minuto y corre: grep -i firebase $APP/trading_bot.log | tail)"
echo
echo "LISTO. Abre https://bolsalab-udem.web.app → Trading (bot): debe decir 'Bot en línea' y origen 'VM Google Cloud'."
echo "Para volver a la versión anterior:  cp $VIEJO.respaldo_$STAMP $VIEJO && cp $APP/.env.respaldo_$STAMP $APP/.env && sudo systemctl restart $SERVICIO"
