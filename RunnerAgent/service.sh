#!/usr/bin/env bash
set -euo pipefail
SERVICE="agent-coder-runner.service"
ACTION="${1:-status}"

case "$ACTION" in
  start|stop|restart|status)
    sudo systemctl "$ACTION" "$SERVICE"
    ;;
  logs)
    sudo journalctl -u "$SERVICE" -f
    ;;
  enable)
    sudo systemctl enable "$SERVICE"
    ;;
  disable)
    sudo systemctl disable "$SERVICE"
    ;;
  *)
    echo "Uso: $0 [start|stop|restart|status|logs|enable|disable]"
    exit 1
    ;;
esac
