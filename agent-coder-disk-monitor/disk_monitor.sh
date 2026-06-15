#!/usr/bin/env bash
set -e
SMTP_ENV_FILE=/home/pi/Agent-IA-Coder/agent-coder-cloudflared-manager/.env
DISK_PATH=/
STATE_DIR=/var/lib/agent-coder-disk-monitor
STATE_FILE=/var/lib/agent-coder-disk-monitor/state
THRESHOLD_KB=2097152
if [ -f /home/pi/Agent-IA-Coder/agent-coder-disk-monitor/.env ]; then
  set -a
  . /home/pi/Agent-IA-Coder/agent-coder-disk-monitor/.env
  set +a
fi
mkdir -p $STATE_DIR
FREE_KB=$(df -Pk $DISK_PATH | awk 'NR==2 {print $4}')
TOTAL_KB=$(df -Pk $DISK_PATH | awk 'NR==2 {print $2}')
USED_KB=$(df -Pk $DISK_PATH | awk 'NR==2 {print $3}')
ALERT_SENT=0
if [ -f $STATE_FILE ]; then
  ALERT_SENT=$(cat $STATE_FILE)
fi
echo Disco $DISK_PATH total_kb=$TOTAL_KB used_kb=$USED_KB free_kb=$FREE_KB threshold_kb=$THRESHOLD_KB alert_sent=$ALERT_SENT
if [ $FREE_KB -lt $THRESHOLD_KB ] && [ $ALERT_SENT != 1 ]; then
  BODY_FILE=$(mktemp)
  cat > $BODY_FILE <<EOF2
Alerta de espacio bajo en disco.

Host: $(hostname)
Fecha: $(date)
Ruta monitoreada: $DISK_PATH
Total KB: $TOTAL_KB
Usado KB: $USED_KB
Libre KB: $FREE_KB
Umbral: menos de 2 GB libres

Este correo se envia una sola vez mientras el disco siga por debajo del umbral.
Cuando se libere espacio y vuelva a quedar por encima del umbral, la alerta se rearmara automaticamente.
EOF2
  SMTP_ENV_FILE=$SMTP_ENV_FILE BODY_FILE=$BODY_FILE python3 - <<'PY'
import os
import smtplib
from email.message import EmailMessage

def load_env(path):
    if not os.path.exists(path):
        return
    for raw in open(path, encoding='utf-8'):
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip())

load_env(os.environ.get('SMTP_ENV_FILE'))
body = open(os.environ.get('BODY_FILE'), encoding='utf-8').read()
msg = EmailMessage()
msg['Subject'] = 'Alerta espacio bajo Orange Pi'
msg['From'] = os.environ.get('SMTP_FROM')
msg['To'] = os.environ.get('SMTP_TO')
msg.set_content(body)
with smtplib.SMTP(os.environ.get('SMTP_HOST'), int(os.environ.get('SMTP_PORT')), timeout=30) as smtp:
    smtp.starttls()
    smtp.login(os.environ.get('SMTP_USER'), os.environ.get('SMTP_PASSWORD'))
    smtp.send_message(msg)
print('Correo de alerta enviado a ' + os.environ.get('SMTP_TO'))
PY
  rm -f $BODY_FILE
  echo 1 > $STATE_FILE
  echo Alerta marcada como enviada
  exit 0
fi
if [ $FREE_KB -ge $THRESHOLD_KB ] && [ $ALERT_SENT = 1 ]; then
  echo 0 > $STATE_FILE
  echo Espacio recuperado alerta rearmada
  exit 0
fi
echo Sin alerta nueva
