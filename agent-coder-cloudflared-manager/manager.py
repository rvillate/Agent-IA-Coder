#!/usr/bin/env python3
import json
import os
import re
import sys
import time
import signal
import socket
import smtplib
import shutil
import subprocess
import urllib.request
import getpass
from datetime import datetime, timezone
from email.message import EmailMessage

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(BASE_DIR, ".env")
GATEWAY_ENV_FILE = "/home/pi/Agent-IA-Coder/agent-coder-raspberry-gateway/.env"
RUNNER_ENV_FILE = "/home/pi/Agent-IA-Coder/agent-coder-remote-runner/.env"
URL_RE = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

running = True
child = None

def log(message: str) -> None:
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)

def read_env_file(path: str) -> dict:
    values = {}
    if not os.path.exists(path):
        return values
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values

def load_env(path: str) -> None:
    for key, value in read_env_file(path).items():
        os.environ.setdefault(key, value)

def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "y", "on")

def run_capture(command: list, timeout: int = 10) -> str:
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        output = (completed.stdout or "").strip()
        error = (completed.stderr or "").strip()
        if completed.returncode != 0 and error:
            return f"ERROR({completed.returncode}): {error}"
        return output or error or ""
    except Exception as exc:
        return f"ERROR: {exc}"

def gateway_health_text() -> str:
    url = os.environ.get("GATEWAY_HEALTH_URL", "http://127.0.0.1:8787/api/health")
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            data = response.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(data)
            counts = parsed.get("counts", {})
            return (
                f"ok={parsed.get('ok')} service={parsed.get('service')} "
                f"runners={counts.get('runners')} jobs={counts.get('jobs')} "
                f"uptimeSec={parsed.get('uptimeSec')} dbFile={parsed.get('dbFile')}"
            )
        except Exception:
            return data[:1000]
    except Exception as exc:
        return f"ERROR consultando health: {exc}"

def split_ips(raw: str) -> list:
    return [part.strip() for part in str(raw or "").split() if part.strip()]

def get_all_local_ips() -> list:
    ips = split_ips(run_capture(["hostname", "-I"]))
    return [ip for ip in ips if not ip.startswith("127.") and ip != "::1"]

def get_primary_local_ip() -> str:
    route = run_capture(["ip", "route", "get", "1.1.1.1"])
    match = re.search(r"\bsrc\s+(\S+)", route)
    if match:
        return match.group(1)
    ips = get_all_local_ips()
    for ip in ips:
        if ip.startswith(("192.168.", "10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.")):
            return ip
    return ips[0] if ips else "No detectada"

def get_ssh_user() -> str:
    configured = os.environ.get("SSH_USER", "").strip()
    if configured:
        return configured
    if os.path.isdir("/home/pi"):
        return "pi"
    return getpass.getuser()

def get_context(public_url: str) -> dict:
    gateway_env = read_env_file(GATEWAY_ENV_FILE)
    runner_env = read_env_file(RUNNER_ENV_FILE)
    api_key = gateway_env.get("AGENT_API_KEY", "")
    shared_key = gateway_env.get("RUNNER_SHARED_KEY", "")
    disk = shutil.disk_usage("/")
    free_gb = disk.free / (1024 ** 3)
    total_gb = disk.total / (1024 ** 3)
    used_gb = disk.used / (1024 ** 3)
    use_percent = int(round((disk.used / disk.total) * 100)) if disk.total else 0
    df_root = run_capture(["df", "-h", "/"])
    df_inodes = run_capture(["df", "-ih", "/"])
    services_enabled = run_capture([
        "systemctl", "is-enabled",
        "agent-coder-gateway.service",
        "agent-coder-runner.service",
        "agent-coder-cloudflared.service",
    ])
    services_active = run_capture([
        "systemctl", "is-active",
        "agent-coder-gateway.service",
        "agent-coder-runner.service",
        "agent-coder-cloudflared.service",
    ])
    runner_url = runner_env.get("GATEWAY_URL", "")
    local_ips = get_all_local_ips()
    primary_local_ip = get_primary_local_ip()
    ssh_user = get_ssh_user()
    ssh_command = f"ssh {ssh_user}@{primary_local_ip}" if primary_local_ip and not primary_local_ip.startswith("No ") else "No disponible"
    return {
        "hostname": socket.gethostname(),
        "now": datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z"),
        "public_url": public_url,
        "base_api_url": f"{public_url}/api",
        "local_gateway_url": os.environ.get("TUNNEL_URL", "http://127.0.0.1:8787"),
        "local_api_url": "http://127.0.0.1:8787/api",
        "agent_api_key": api_key,
        "runner_shared_key": shared_key,
        "runner_id": runner_env.get("RUNNER_ID", ""),
        "runner_gateway_url": runner_url,
        "workspace_root": runner_env.get("WORKSPACE_ROOT", ""),
        "gateway_health": gateway_health_text(),
        "disk_summary": f"{free_gb:.1f}G libres de {total_gb:.1f}G total ({use_percent}% usado, {used_gb:.1f}G usados)",
        "df_root": df_root,
        "df_inodes": df_inodes,
        "services_enabled": services_enabled,
        "services_active": services_active,
        "local_ips": " ".join(local_ips) if local_ips else "No detectadas",
        "primary_local_ip": primary_local_ip,
        "ssh_user": ssh_user,
        "runtime_user": getpass.getuser(),
        "ssh_command": ssh_command,
    }

def build_email_body(public_url: str) -> str:
    c = get_context(public_url)
    warning = ""
    if c["runner_gateway_url"] != c["local_api_url"]:
        warning = (
            "ADVERTENCIA: el runner no apunta al gateway local. "
            f"GATEWAY_URL actual: {c['runner_gateway_url']}\n"
            f"Debe ser: {c['local_api_url']}\n\n"
        )
    return f"""Se inicio/reinicio el tunnel Cloudflared.

Host: {c['hostname']}
Fecha: {c['now']}

ACCESO LOCAL / SSH
IP local principal Orange Pi: {c['primary_local_ip']}
IPs detectadas: {c['local_ips']}
Usuario SSH recomendado: {c['ssh_user']}
Usuario que ejecuta el manager: {c['runtime_user']}
Comando SSH sugerido: {c['ssh_command']}

DATOS PARA RETOMAR EN CHATGPT/GPT
URL publica nueva: {c['public_url']}
Base URL para el Action/GPT: {c['base_api_url']}
Header requerido: x-agent-key
AGENT_API_KEY: {c['agent_api_key']}
RUNNER_SHARED_KEY: {c['runner_shared_key']}

IMPORTANTE
Al reiniciar la Orange Pi, la AGENT_API_KEY no cambia salvo que se modifique el archivo .env del gateway.
Lo normal es que solo cambie la URL publica trycloudflare. En el GPT/Action solo cambia la Base URL a:
{c['base_api_url']}
Manten el mismo header x-agent-key con la AGENT_API_KEY de arriba.

Estado local:
Gateway local: {c['local_gateway_url']}
API local: {c['local_api_url']}
Health gateway: {c['gateway_health']}
Runner ID: {c['runner_id']}
Runner GATEWAY_URL: {c['runner_gateway_url']}
Workspace runner: {c['workspace_root']}

Espacio disponible:
{c['disk_summary']}

df -h /:
{c['df_root']}

Inodos df -ih /:
{c['df_inodes']}

Servicios systemd:
enabled:
{c['services_enabled']}

active:
{c['services_active']}

Checklist rapido si algo falla:
1. Entra por SSH a la Orange Pi con: {c['ssh_command']}
2. Ejecuta: curl -s http://127.0.0.1:8787/api/health | jq .
3. Ejecuta: systemctl status agent-coder-gateway.service agent-coder-runner.service agent-coder-cloudflared.service --no-pager -l
4. Ejecuta: journalctl -u agent-coder-runner.service -n 80 --no-pager
5. Verifica que /home/pi/Agent-IA-Coder/agent-coder-remote-runner/.env tenga:
   GATEWAY_URL=http://127.0.0.1:8787/api
6. En el GPT/Action usa:
   Base URL: {c['base_api_url']}
   Header: x-agent-key
   Value: AGENT_API_KEY de este correo

{warning}"""

def wait_gateway() -> bool:
    url = os.environ.get("GATEWAY_HEALTH_URL", "http://127.0.0.1:8787/api/health")
    timeout = int(os.environ.get("GATEWAY_WAIT_TIMEOUT_SEC", "300"))
    interval = int(os.environ.get("GATEWAY_CHECK_INTERVAL_SEC", "5"))
    deadline = time.time() + timeout
    last_error = None
    while running and time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if 200 <= response.status < 500:
                    log(f"Gateway disponible: {url} status={response.status}")
                    return True
        except Exception as exc:
            last_error = exc
        log(f"Esperando gateway en {url}. Ultimo error: {last_error}")
        time.sleep(interval)
    return False

def send_email(public_url: str) -> None:
    if not env_bool("SMTP_ENABLED", True):
        log("SMTP deshabilitado. No se envia correo.")
        return
    smtp_host = os.environ.get("SMTP_HOST", "").strip()
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "").strip()
    smtp_password = os.environ.get("SMTP_PASSWORD", "")
    mail_from = os.environ.get("SMTP_FROM", smtp_user).strip()
    mail_to = os.environ.get("SMTP_TO", "").strip()
    use_tls = env_bool("SMTP_USE_TLS", True)
    if not smtp_host or not smtp_user or not smtp_password or not mail_from or not mail_to:
        log("SMTP incompleto. Configura SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM y SMTP_TO")
        return
    hostname = socket.gethostname()
    msg = EmailMessage()
    msg["Subject"] = os.environ.get("SMTP_SUBJECT", f"Nuevo tunnel Cloudflared - {hostname}")
    msg["From"] = mail_from
    msg["To"] = mail_to
    msg.set_content(build_email_body(public_url))
    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as smtp:
            if use_tls:
                smtp.starttls()
            smtp.login(smtp_user, smtp_password)
            smtp.send_message(msg)
        log(f"Correo enviado a {mail_to} con URL {public_url}")
    except Exception as exc:
        log(f"ERROR enviando correo SMTP: {exc}")

def stop_child() -> None:
    global child
    if child and child.poll() is None:
        log("Deteniendo cloudflared...")
        child.terminate()
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=10)

def handle_signal(signum, frame) -> None:
    global running
    running = False
    stop_child()

def run_cloudflared_loop() -> None:
    global child
    tunnel_url = os.environ.get("TUNNEL_URL", "http://127.0.0.1:8787")
    command = [os.environ.get("CLOUDFLARED_BIN", "/usr/local/bin/cloudflared"), "tunnel", "--url", tunnel_url]
    restart_delay = int(os.environ.get("CLOUDFLARED_RESTART_DELAY_SEC", "10"))
    last_sent_url = None
    while running:
        if not wait_gateway():
            log("Gateway no disponible dentro del timeout. Reintentando ciclo.")
            time.sleep(restart_delay)
            continue
        log("Iniciando cloudflared: " + " ".join(command))
        child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        try:
            assert child.stdout is not None
            for line in child.stdout:
                line = line.rstrip()
                if line:
                    log("cloudflared: " + line)
                match = URL_RE.search(line)
                if match:
                    current_url = match.group(0)
                    if current_url != last_sent_url:
                        last_sent_url = current_url
                        send_email(current_url)
                if not running:
                    break
        finally:
            stop_child()
        code = child.poll()
        log(f"cloudflared termino con codigo {code}. Reiniciando en {restart_delay}s.")
        time.sleep(restart_delay)

def main() -> int:
    load_env(ENV_FILE)
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    run_cloudflared_loop()
    return 0

if __name__ == "__main__":
    sys.exit(main())
