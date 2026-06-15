# Agent Coder Cloudflared Manager

Este manager inicia `cloudflared tunnel --url http://127.0.0.1:8787`, espera primero que el gateway local este disponible, captura la URL aleatoria `trycloudflare.com` y envia un correo cada vez que aparezca una URL nueva.

Tambien reinicia `cloudflared` si se cae. El servicio systemd reinicia el manager si el manager falla.

Configura SMTP en:

```bash
/home/pi/Agent-IA-Coder/agent-coder-cloudflared-manager/.env
```

Comandos utiles:

```bash
sudo systemctl status agent-coder-cloudflared.service
sudo journalctl -u agent-coder-cloudflared.service -f
sudo systemctl restart agent-coder-cloudflared.service
```
