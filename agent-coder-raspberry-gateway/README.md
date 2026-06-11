# Agent Coder Raspberry Gateway

Gateway central para controlar runners remotos desde un GPT personalizado usando una API HTTPS expuesta por Cloudflare Tunnel.

Este proyecto va en la Raspberry Pi o en el equipo que quieras usar como servidor central.

```text
ChatGPT GPT Action
        ↓ HTTPS
Cloudflare Tunnel
        ↓
Raspberry Pi: Agent Coder Gateway
        ↓
DB local JSON centralizada
        ↓
Runners remotos conectados desde otros PCs
        ↓
Workspaces locales de cada runner
```

## Qué problema resuelve

Reemplaza Firebase Realtime Database y Firebase Functions por una arquitectura local:

- La DB central queda en la Raspberry Pi.
- Los runners se conectan a la Raspberry usando HTTP/HTTPS.
- El GPT se conecta al gateway mediante una URL pública de Cloudflare Tunnel.
- Los logs completos se quedan en cada runner, para no gastar tráfico ni llenar la DB.
- La DB central solo guarda estados, payloads, resultados resumidos y últimas líneas de salida.

## Requisitos

En la Raspberry Pi:

- Node.js 18.18 o superior. Recomendado Node.js 20 o 22.
- npm.
- Acceso a red local o internet.
- Opcional: `cloudflared` para exponer el gateway al GPT.

En tu PC runner:

- El proyecto `agent-coder-remote-runner`.
- Node.js 18.18 o superior.
- Acceso HTTP/HTTPS hacia la Raspberry o hacia la URL de Cloudflare.

## 1. Extraer el ZIP en la Raspberry Pi

Ejemplo:

```bash
cd /home/pi
unzip agent-coder-raspberry-gateway.zip
cd agent-coder-raspberry-gateway
```

En Windows sería:

```powershell
cd C:\agent-coder-raspberry-gateway
```

## 2. Instalar dependencias

```bash
npm install
```

## 3. Crear el archivo .env

```bash
cp .env.example .env
nano .env
```

En Windows:

```powershell
copy .env.example .env
notepad .env
```

## 4. Generar claves

Genera una clave para GPT/panel:

```bash
npm run generate:key
```

Pégala en:

```env
AGENT_API_KEY=pega_aqui_la_key_del_gpt
```

Genera otra clave para runners:

```bash
npm run generate:key
```

Pégala en:

```env
RUNNER_SHARED_KEY=pega_aqui_la_key_de_los_runners
```

El `.env` debe quedar parecido a esto:

```env
PORT=8787
HOST=0.0.0.0
AGENT_API_KEY=clave_larga_para_gpt
RUNNER_SHARED_KEY=clave_larga_para_runners
AGENT_DB_FILE=data/agent-coder.central.json
AGENT_BACKUP_DIR=data/backups
MAX_TAIL_CHARS=24000
PUBLIC_BASE_URL=
PUBLIC_HEALTH=true
```

## 5. Dónde queda la DB

Por defecto queda aquí:

```text
agent-coder-raspberry-gateway/data/agent-coder.central.json
```

Esa es la DB centralizada.

No la compartas por red para que otros procesos escriban directamente. Los runners deben conectarse por API, no editar ese archivo.

## 6. Ejecutar el gateway

```bash
npm start
```

Debe mostrar algo parecido a:

```text
Agent Coder Raspberry Gateway listo en http://0.0.0.0:8787
DB central: /home/pi/agent-coder-raspberry-gateway/data/agent-coder.central.json
OpenAPI: /api/openapi.json
```

Prueba local:

```bash
curl http://localhost:8787/api/health
```

Desde otro PC en la misma red:

```bash
curl http://IP_DE_LA_RASPBERRY:8787/api/health
```

## 7. Panel web local

Abre en navegador:

```text
http://IP_DE_LA_RASPBERRY:8787
```

En el panel coloca:

```text
API base URL: /api
x-agent-key: valor de AGENT_API_KEY
Runner target: local-runner-1 o el ID real de tu runner
```

## 8. Exponer con Cloudflare Quick Tunnel para pruebas

En otra terminal de la Raspberry:

```bash
cloudflared tunnel --url http://localhost:8787
```

Cloudflare mostrará una URL tipo:

```text
https://algo-random.trycloudflare.com
```

Prueba:

```bash
curl https://algo-random.trycloudflare.com/api/health
```

El OpenAPI para GPT será:

```text
https://algo-random.trycloudflare.com/api/openapi.json
```

La URL de Quick Tunnel puede cambiar cada vez que reinicies el túnel.

## 9. Usar dominio estable con Cloudflare Tunnel

Para uso diario conviene un subdominio fijo, por ejemplo:

```text
https://agent.raulvillate.dev
```

Pasos generales en la Raspberry:

```bash
cloudflared tunnel login
cloudflared tunnel create agent-coder
cloudflared tunnel route dns agent-coder agent.raulvillate.dev
cloudflared tunnel run agent-coder --url http://localhost:8787
```

Luego en `.env` puedes colocar:

```env
PUBLIC_BASE_URL=https://agent.raulvillate.dev
```

Reinicia el gateway.

## 10. Configurar el GPT personalizado

En ChatGPT:

```text
Explorar GPTs → Crear → Configurar → Actions → Create new action
```

Autenticación:

```text
Authentication: API Key
API Key type: Custom header
Header name: x-agent-key
Value: AGENT_API_KEY de la Raspberry
```

Importa el schema desde:

```text
https://TU_URL_CLOUDFLARE/api/openapi.json
```

En instrucciones del GPT usa el archivo:

```text
actions/gpt-action-instructions.md
```

## 11. Endpoints principales para GPT

```text
GET    /api/health
GET    /api/runners
GET    /api/jobs
POST   /api/jobs
POST   /api/jobs/bulk
GET    /api/jobs/:id
PATCH  /api/jobs/:id
POST   /api/jobs/:id/cancel
POST   /api/jobs/:id/requeue
DELETE /api/jobs/:id
```

## 12. Endpoints privados para runners

Estos usan header:

```text
x-runner-key: RUNNER_SHARED_KEY
```

Endpoints:

```text
POST /api/runner/register
POST /api/runner/heartbeat
POST /api/runner/claim-next
POST /api/runner/jobs/:id/update
```

El GPT no necesita usar estos endpoints.

## 13. Crear un job de prueba desde PowerShell

```powershell
$KEY="TU_AGENT_API_KEY"
$BASE="http://IP_DE_LA_RASPBERRY:8787/api"

Invoke-RestMethod `
  -Uri "$BASE/jobs" `
  -Method Post `
  -Headers @{"x-agent-key"=$KEY} `
  -ContentType "application/json" `
  -Body '{"type":"file.list","runnerTarget":"local-runner-1","payload":{"path":".","maxDepth":2}}'
```

## 14. Ejecutar como servicio en Raspberry Pi

Crea un archivo:

```bash
sudo nano /etc/systemd/system/agent-coder-gateway.service
```

Contenido:

```ini
[Unit]
Description=Agent Coder Raspberry Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/pi/agent-coder-raspberry-gateway
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
User=pi

[Install]
WantedBy=multi-user.target
```

Activa:

```bash
sudo systemctl daemon-reload
sudo systemctl enable agent-coder-gateway
sudo systemctl start agent-coder-gateway
sudo systemctl status agent-coder-gateway
```

## 15. Limpieza de jobs viejos

Desde el panel o API puedes limpiar jobs viejos:

```bash
curl -X POST http://localhost:8787/api/admin/cleanup \
  -H "x-agent-key: TU_AGENT_API_KEY" \
  -H "content-type: application/json" \
  -d '{"olderThanHours":24}'
```

## 16. Seguridad mínima recomendada

- No compartas `AGENT_API_KEY`.
- No compartas `RUNNER_SHARED_KEY`.
- Usa claves diferentes para GPT y runners.
- Cloudflare puede dejar pública la URL, pero tu API queda protegida por `x-agent-key`.
- Los runners nunca deben permitir rutas fuera de su `WORKSPACE_ROOT`.
- Mantén `RUNNER_ALLOW_DANGEROUS_COMMANDS=false` en los runners.
- Mantén `RUNNER_REQUIRE_LOCAL_APPROVAL=true` para comandos shell.

## 17. Troubleshooting

### El GPT no ve runners

Verifica que el runner esté conectado:

```bash
curl http://localhost:8787/api/runners -H "x-agent-key: TU_AGENT_API_KEY"
```

Si no aparece, revisa en el runner:

```text
GATEWAY_URL
RUNNER_SHARED_KEY
RUNNER_ID
```

### 401 x-agent-key inválida

La clave usada por el GPT o panel no coincide con `AGENT_API_KEY`.

### 401 x-runner-key inválida

La clave del runner no coincide con `RUNNER_SHARED_KEY`.

### El job queda queued

El runner destino no está conectado o el `runnerTarget` no coincide exactamente con el `RUNNER_ID`.

### El job queda needs_approval

Ve a la terminal del runner y aprueba con `y`.

### La URL de Cloudflare cambió

Si usas Quick Tunnel, la URL puede cambiar. Actualiza el OpenAPI en el GPT o usa un túnel estable con dominio.

## Configuración .env del admin

El archivo `.env` del admin/gateway quedó documentado en español y usa placeholders limpios. Ajusta estos valores antes de producción:

- `PORT` y `HOST`: puerto y host de la API/panel.
- `AGENT_API_KEY`: clave para GPT Actions y panel web.
- `RUNNER_SHARED_KEY`: clave compartida con los runners. Debe coincidir con cada runner.
- `AGENT_DB_FILE`: archivo JSON de la DB centralizada.
- `AGENT_BACKUP_DIR`: carpeta para backups de la DB.
- `MAX_TAIL_CHARS`: límite de salida guardada por job.
- `PUBLIC_BASE_URL`: URL pública opcional para OpenAPI.
- `PUBLIC_HEALTH`: permite `/api/health` sin key cuando está en `true`.

La web del panel se compactó para ocupar menos espacio vertical: márgenes pequeños, controles más bajos, tarjetas compactas y salida con altura reducida.
