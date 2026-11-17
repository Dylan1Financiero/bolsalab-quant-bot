#!/usr/bin/env bash
# =====================================================================
#  BolsaLab · instala o actualiza el bot en la VM de Google Cloud
#  Uso (en la ventana SSH, después de subir los 4 archivos):
#       bash instalar_vm.sh
#  Archivos que deben estar en tu carpeta home de la VM:
#       bot_trading.py  env_vm.txt  firebase-credenciales.json  instalar_vm.sh
# =====================================================================
set -euo pipefail
APP="$HOME/bot_quant"
SERVICIO="bot-quant"
mkdir -p "$APP"

echo "[1/6] Moviendo archivos a $APP"
[ -f "$HOME/bot_trading.py" ] && mv -f "$HOME/bot_trading.py" "$APP/bot_trading.py"
[ -f "$HOME/env_vm.txt" ] && mv -f "$HOME/env_vm.txt" "$APP/.env"
[ -f "$HOME/firebase-credenciales.json" ] && mv -f "$HOME/firebase-credenciales.json" "$APP/firebase-credenciales.json"
for f in bot_trading.py .env firebase-credenciales.json; do
  [ -f "$APP/$f" ] || { echo "FALTA $APP/$f · súbelo y vuelve a correr el script"; exit 1; }
done
grep -q '^BOT_ORIGEN=' "$APP/.env" || printf '\nBOT_ORIGEN=VM Google Cloud\n' >> "$APP/.env"
chmod 600 "$APP/.env" "$APP/firebase-credenciales.json"

echo "[2/6] Deteniendo versiones anteriores del bot"
sudo systemctl stop "$SERVICIO" 2>/dev/null || true
pkill -f "bot_trading.py" 2>/dev/null || true
sleep 2

echo "[3/6] Python y entorno virtual"
if ! python3 -m venv --help >/dev/null 2>&1 || ! python3 -c "import ensurepip" >/dev/null 2>&1; then
  sudo apt-get update -y && sudo apt-get install -y python3 python3-venv python3-pip
fi
[ -x "$APP/venv/bin/python" ] || python3 -m venv "$APP/venv"

echo "[4/6] Librerías (la primera vez tarda unos minutos)"
"$APP/venv/bin/python" -m pip install --quiet --upgrade pip
"$APP/venv/bin/python" -m pip install --quiet numpy pandas matplotlib scikit-learn scipy \
  gate-api google-genai "python-telegram-bot>=21" python-dotenv openpyxl psutil firebase-admin requests
"$APP/venv/bin/python" -m pip install --quiet catboost || echo "Aviso: CatBoost no se instaló; el bot funciona solo con Random Forest."

echo "[5/6] Verificación de llaves, testnet, Firebase y Gemini"
cd "$APP"
"$APP/venv/bin/python" bot_trading.py --verificar || echo "Revisa arriba los puntos marcados con error antes de la defensa."

echo "[6/6] Servicio systemd (24/7, se reinicia solo)"
sudo tee "/etc/systemd/system/$SERVICIO.service" >/dev/null <<EOF
[Unit]
Description=BolsaLab bot de trading (Telegram + Gate testnet + Firebase)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP
ExecStart=$APP/venv/bin/python -u $APP/bot_trading.py
Restart=always
RestartSec=15
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICIO" >/dev/null 2>&1
sudo systemctl restart "$SERVICIO"
sleep 8
sudo systemctl status "$SERVICIO" --no-pager -l | head -15
echo
echo "LISTO. Comandos útiles:"
echo "  Ver el log:        tail -f $APP/trading_bot.log      (Ctrl+C para salir)"
echo "  Reiniciar el bot:  sudo systemctl restart $SERVICIO"
echo "  Detener el bot:    sudo systemctl stop $SERVICIO"
echo "  Estado:            sudo systemctl status $SERVICIO"
