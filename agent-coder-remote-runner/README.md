# Agent Coder Remote Runner

Runner remoto para conectarse al gateway central que estará en la Raspberry Pi.

Este proyecto va en cada PC que quieras controlar como runner.

```text
Raspberry Pi: Agent Coder Gateway
        ↓
Runner remoto en este PC
        ↓
WORKSPACE_ROOT local
        ↓
Archivos, comandos, Git, builds
```

## Qué hace este runner

- Se registra en el gateway central.
- Envía heartbeat para aparecer online.
- Consulta jobs pendientes para su `RUNNER_ID`.
- Ejecuta acciones dentro de un workspace seguro.
- Devuelve resultado resumido al gateway.
- Guarda logs completos localmente en `logs/`.

## Tipos de job soportados

```text
shell.exec
file.list
file.read
file.write
file.delete
file.mkdir
file.search
git.status
git.diff
```

## 1. Extraer el ZIP en el PC runner

Windows:

```powershell
cd C:\
Expand-Archive .\agent-coder-remote-runner.zip -DestinationPath C:\agent-coder-remote-runner
cd C:\agent-coder-remote-runner
```

Linux/Raspberry/servidor:

```bash
cd /home/pi
unzip agent-coder-remote-runner.zip
cd agent-coder-remote-runner
```

## 2. Instalar dependencias

Este runner no usa paquetes externos, pero ejecuta:

```bash
npm install
```

## 3. Crear el archivo .env

Windows:

```powershell
copy .env.example .env
notepad .env
```

Linux:

```bash
cp .env.example .env
nano .env
```

## 4. Configurar conexión al gateway central

Si el runner está en la misma red que la Raspberry:

```env
GATEWAY_URL=http://IP_DE_LA_RASPBERRY:8787/api
```

Ejemplo:

```env
GATEWAY_URL=http://192.168.1.50:8787/api
```

Si el runner está en otra red y se conecta por Cloudflare:

```env
GATEWAY_URL=https://neighbors-lenders-went-prozac.trycloudflare.com/api
```

O con Quick Tunnel:

```env
GATEWAY_URL=https://algo-random.trycloudflare.com/api
```

## 5. Configurar la clave del runner

En la Raspberry tienes:

```env
RUNNER_SHARED_KEY=clave_larga_para_runners
```

En este runner debe quedar igual:

```env
RUNNER_SHARED_KEY=clave_larga_para_runners
```

No uses `AGENT_API_KEY` aquí. Esa es para GPT/panel. El runner usa `RUNNER_SHARED_KEY`.

## 6. Configurar RUNNER_ID

Cada PC debe tener un ID único.

PC principal:

```env
RUNNER_ID=local-runner-1
```

PC externo:

```env
RUNNER_ID=external-runner-2
```

Raspberry como runner adicional:

```env
RUNNER_ID=raspberry-runner
```

El GPT debe crear jobs usando exactamente ese valor en `runnerTarget`.

## 7. Configurar WORKSPACE_ROOT

Este es el único directorio que el runner podrá controlar.

Windows:

```env
WORKSPACE_ROOT=C:/agent-workspace
```

Linux:

```env
WORKSPACE_ROOT=/home/pi/agent-workspace
```

Crea la carpeta si no existe:

Windows:

```powershell
New-Item -ItemType Directory -Force C:\agent-workspace
```

Linux:

```bash
mkdir -p /home/pi/agent-workspace
```

## 8. Configuración segura recomendada

```env
RUNNER_REQUIRE_LOCAL_APPROVAL=true
RUNNER_ALLOW_DANGEROUS_COMMANDS=false
RUNNER_ALLOW_DELETE=false
```

Con eso:

- `shell.exec` pedirá aprobación en la terminal antes de ejecutar.
- Solo se permiten comandos de la allowlist.
- `file.delete` queda bloqueado.

Allowlist por defecto:

```env
COMMAND_ALLOWLIST=node,npm,npx,pnpm,yarn,git,mvn,gradle,java,dotnet,python,py,where,cmd
```

## 9. Ejecutar runner

```bash
npm start
```

Debe mostrar algo parecido a:

```text
Agent Coder Remote Runner
Runner ID: local-runner-1
Gateway: http://192.168.1.50:8787/api
Workspace: C:\agent-workspace
Registrado en gateway central.
```

Luego en el panel del gateway o GPT debe aparecer online.

## 10. Crear un job desde el panel o GPT

Ejemplo `file.list`:

```json
{
  "type": "file.list",
  "runnerTarget": "local-runner-1",
  "payload": {
    "path": ".",
    "maxDepth": 2
  }
}
```

Ejemplo `shell.exec`:

```json
{
  "type": "shell.exec",
  "runnerTarget": "local-runner-1",
  "payload": {
    "command": "node",
    "args": ["-v"],
    "cwd": ".",
    "timeoutMs": 30000,
    "shell": false
  }
}
```

Si `RUNNER_REQUIRE_LOCAL_APPROVAL=true`, la terminal preguntará:

```text
Aprobar? [y/N]:
```

Presiona `y` y Enter para ejecutar.

## 11. Logs completos

Los logs completos de comandos se guardan en:

```text
agent-coder-remote-runner/logs/
```

El gateway solo recibe `stdoutTail` y `stderrTail` para ahorrar tráfico y mantener liviana la DB central.

## 12. Ejecutar como servicio en Windows

Puedes usar NSSM o el Programador de tareas. Forma simple con PowerShell manual:

```powershell
cd C:\agent-coder-remote-runner
npm start
```

Para producción, una opción práctica es usar `pm2`:

```powershell
npm install -g pm2
pm2 start src/index.js --name agent-coder-runner
pm2 save
```

## 13. Ejecutar como servicio en Linux

Crea:

```bash
sudo nano /etc/systemd/system/agent-coder-runner.service
```

Contenido:

```ini
[Unit]
Description=Agent Coder Remote Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/pi/agent-coder-remote-runner
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
sudo systemctl enable agent-coder-runner
sudo systemctl start agent-coder-runner
sudo systemctl status agent-coder-runner
```

## 14. Varios runners conectados a la misma Raspberry

En cada PC copias este proyecto y cambias solo:

```env
RUNNER_ID=un-id-unico
WORKSPACE_ROOT=una-carpeta-local-de-ese-pc
GATEWAY_URL=http://IP_O_URL_DE_LA_RASPBERRY:8787/api
RUNNER_SHARED_KEY=la_misma_key_de_runners
```

Ejemplo:

```text
Raspberry Gateway
├── local-runner-1         → PC principal
├── external-runner-2      → portátil
└── raspberry-runner       → la misma Raspberry actuando como runner
```

## 15. Troubleshooting

### No aparece en runners

Revisa:

```env
GATEWAY_URL
RUNNER_SHARED_KEY
RUNNER_ID
```

Prueba health:

```bash
curl http://IP_DE_LA_RASPBERRY:8787/api/health
```

### Error 401 x-runner-key inválida

La clave del runner no coincide con `RUNNER_SHARED_KEY` del gateway.

### Job queda queued

El `runnerTarget` del job no coincide con el `RUNNER_ID`.

### Comando bloqueado

El comando no está en `COMMAND_ALLOWLIST` o `RUNNER_ALLOW_DANGEROUS_COMMANDS=false` lo bloqueó.

### file.delete bloqueado

Activa bajo tu responsabilidad:

```env
RUNNER_ALLOW_DELETE=true
```

### Ruta fuera del workspace

El runner bloquea cualquier ruta que salga de `WORKSPACE_ROOT`. Usa rutas relativas dentro del workspace.

## Configuración de comandos para agente de codificación

El runner soporta dos estilos de `shell.exec`:

```json
{ "command": "git", "args": ["status", "--short"], "path": "." }
```

```json
{ "command": "git status --short && node --version", "path": "." }
```

Flags principales del `.env`:

- `RUNNER_ALLOW_ALL_COMMANDS=true`: permite cualquier ejecutable y omite la allowlist. Es el valor por defecto para desarrollo local.
- `RUNNER_ALLOW_ALL_COMMANDS=false`: obliga a validar contra `COMMAND_ALLOWLIST`.
- `RUNNER_ALLOW_DANGEROUS_COMMANDS=true`: permite patrones sensibles como `rm -rf`, `format`, `shutdown`, `diskpart`, etc.
- `RUNNER_ALLOW_DANGEROUS_COMMANDS=false`: bloquea esos patrones aunque el ejecutable esté permitido.
- `RUNNER_ALLOW_SENSITIVE_COMMANDS=true`: agrega herramientas sensibles como `powershell`, `bash`, `curl`, `ssh`, `docker` y `kubectl`.
- `RUNNER_ALLOW_DELETE=true`: habilita `file.delete`.

Comandos de desarrollo incluidos en la allowlist base: Node/NPM, Git, ripgrep/grep/findstr, Java/Maven/Gradle, .NET, Python/pytest, Go, Rust/Cargo, TypeScript, ESLint, Prettier, Vite, Next, Jest, Vitest y Playwright.

## 16. Varios workspaces en un mismo runner

El runner puede permitir varias raíces locales sin crear runners adicionales. Mantiene compatibilidad con `WORKSPACE_ROOT` y agrega `WORKSPACE_ROOTS`.

Configuración simple, una sola raíz:

```env
WORKSPACE_ROOT=/home/pi/Agent-IA-Coder
```

Configuración con varias raíces:

```env
WORKSPACE_ROOTS=/home/pi/Agent-IA-Coder,/home/pi/Proyectos/KITs
```

También se aceptan `;` o `|` como separadores:

```env
WORKSPACE_ROOTS=/home/pi/Agent-IA-Coder;/home/pi/Proyectos/KITs
WORKSPACE_ROOTS=/home/pi/Agent-IA-Coder|/home/pi/Proyectos/KITs
```

Reglas:

- Si `WORKSPACE_ROOTS` está definido, esa lista manda sobre `WORKSPACE_ROOT`.
- La primera ruta de `WORKSPACE_ROOTS` queda como workspace principal.
- Las rutas relativas se resuelven contra el workspace principal.
- Las rutas absolutas se aceptan si están dentro de cualquiera de los workspaces permitidos.
- El runner reporta al gateway `workspaceRoot` y también `workspaceRoots`.

Ejemplo de uso desde un job:

```json
{
  "type": "file.list",
  "runnerTarget": "master-server",
  "payload": {
    "path": "/home/pi/Proyectos/KITs",
    "maxDepth": 1
  }
}
```


## 17. Jobs en paralelo

Por defecto el runner ejecuta un job a la vez:

```env
RUNNER_MAX_CONCURRENT_JOBS=1
```

Para permitir tareas de diagnóstico mientras un build o deploy largo sigue corriendo, se puede subir a `2`:

```env
RUNNER_MAX_CONCURRENT_JOBS=2
```

Recomendación:

- `1`: modo seguro/secuencial, ideal por defecto.
- `2`: permite revisar logs, procesos o estado mientras hay un job largo.
- Valores mayores deben usarse con cuidado porque pueden mezclar builds, deploys o cambios de archivos sobre el mismo workspace.

El runner reporta al gateway `maxConcurrentJobs` y `activeJobs` para saber cuántos jobs puede ejecutar y cuáles están activos.

## 18. Runner inteligente: búsquedas, cola y logs

El runner intenta optimizarse solo sin perfiles por equipo. Las decisiones se toman por tipo de job, payload, límites configurados y capacidades locales.

### Búsqueda inteligente

`file.search` acepta `query`, `pattern` o `text` y usa `ripgrep (rg)` automáticamente cuando está instalado. Si `rg` no existe o falla en modo `auto`, cae al motor JS interno.

Parámetros útiles por job:

```json
{
  "path": ".",
  "query": "ClienteEmpresarial",
  "maxMatches": 100,
  "maxDepth": 8,
  "maxFiles": 20000,
  "timeoutMs": 30000,
  "extensions": ["ts", "html"],
  "showIgnored": false,
  "showHidden": false
}
```

La respuesta incluye `engine`, `durationMs` y `stats` para diagnosticar búsquedas lentas.

### Ignorados inteligentes

Por defecto el runner omite carpetas pesadas como:

```text
node_modules,.git,dist,build,.next,.angular,target,coverage,.idea,.vscode,.cache,.turbo,logs
```

Se puede desactivar por job usando `showIgnored=true`, o globalmente con:

```env
RUNNER_USE_SMART_IGNORES=false
```

### Listados rápidos

`file.list` usa modo rápido por defecto para evitar `stat` completo sobre cada carpeta. Si necesitas metadata completa, envía:

```json
{ "path": ".", "fast": false }
```

### Cola local por peso de job

El runner clasifica automáticamente jobs como `light` o `heavy`.

- `light`: lecturas, búsquedas acotadas, `git.status`, `git.diff`.
- `heavy`: escrituras, borrados, builds, tests, deploys, Docker/Kubernetes y comandos potencialmente destructivos.

Reglas:

- Respeta `RUNNER_MAX_CONCURRENT_JOBS` como límite total.
- Respeta `RUNNER_MAX_HEAVY_JOBS` para evitar demasiados builds/deploys simultáneos.
- Evita dos jobs pesados al mismo tiempo sobre el mismo workspace.
- Permite que jobs livianos corran mientras un job pesado está activo, si hay cupo.

### Cancelación robusta

En Windows, al cancelar o expirar un comando, el runner usa `taskkill /T /F` para matar el árbol de procesos. En Linux/macOS usa `SIGTERM` y luego `SIGKILL` si el proceso no termina.

### Heartbeat con métricas

El heartbeat reporta además:

- `activeJobDetails`
- `queuedJobDetails`
- `maxHeavyJobs`
- memoria libre/usada
- load average cuando el sistema lo soporta
- últimos jobs ejecutados

### Rotación de logs

Los logs locales se limpian automáticamente según:

```env
RUNNER_LOG_MAX_FILES=500
RUNNER_LOG_MAX_AGE_DAYS=14
RUNNER_LOG_MAX_SIZE_MB=25
```

Usa `0` para desactivar cualquiera de esos límites.
