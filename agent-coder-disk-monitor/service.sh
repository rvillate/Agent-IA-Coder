#!/usr/bin/env bash
set -e
SERVICE=agent-coder-disk-monitor.service
TIMER=agent-coder-disk-monitor.timer
ACTION=${1:-status}
case $ACTION in
  start|stop|restart|status)
    sudo systemctl $ACTION $TIMER
    sudo systemctl status $SERVICE $TIMER --no-pager || true
    ;;
  run-once)
    sudo systemctl start $SERVICE
    sudo systemctl status $SERVICE --no-pager || true
    ;;
  logs)
    sudo journalctl -u $SERVICE -u $TIMER -f
    ;;
  enable)
    sudo systemctl enable $TIMER
    ;;
  disable)
    sudo systemctl disable $TIMER
    ;;
  *)
    echo Uso: $0 start stop restart status run-once logs enable disable
    exit 1
    ;;
esac
