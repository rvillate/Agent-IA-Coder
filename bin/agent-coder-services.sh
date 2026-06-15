#!/usr/bin/env bash
set -euo pipefail
ACTION="${1:-status}"

SERVICES=(
  agent-coder-gateway.service
  agent-coder-runner.service
  agent-coder-cloudflared.service
)

case "$ACTION" in
  start|stop|restart|status|enable|disable)
    for svc in "${SERVICES[@]}"; do
      echo "==> $ACTION $svc"
      sudo systemctl "$ACTION" "$svc"
    done
    ;;
  logs)
    sudo journalctl -u agent-coder-gateway.service -u agent-coder-runner.service -u agent-coder-cloudflared.service -f
    ;;
  *)
    echo "Uso: $0 [start|stop|restart|status|logs|enable|disable]"
    exit 1
    ;;
esac
