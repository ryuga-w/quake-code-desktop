#!/usr/bin/env bash
set -Eeuo pipefail

# Quake Code remote SSH/ngrok repair + expiry report.
#
# This script is intentionally distribution-agnostic and does not use
# systemd. It never prints passwords, API tokens, private keys, or env values.
# Run it as root on the Linux server:
#   bash remote-ssh-ngrok-repair.sh
#
# Optional environment variables:
#   SSH_PORT=22                 Local sshd port.
#   NGROK_BIN=ngrok             ngrok executable path/name.
#   NGROK_AUTOSTART=1           Start ngrok when no tunnel is detected (default 1).
#   ENABLE_ROOT_PASSWORD=1      Write a temporary root/password SSH override.
#                                Default 0; use only for this short diagnostic.
#   QUAKE_NGROK_LOG=/var/log/quak...  ngrok log path.

SSH_PORT="${SSH_PORT:-22}"
NGROK_BIN="${NGROK_BIN:-ngrok}"
NGROK_AUTOSTART="${NGROK_AUTOSTART:-1}"
ENABLE_ROOT_PASSWORD="${ENABLE_ROOT_PASSWORD:-0}"
NGROK_LOG="${QUAKE_NGROK_LOG:-/tmp/quake-ngrok-tcp.log}"
SSHD_LOG="${QUAKE_SSHD_LOG:-/tmp/quake-sshd.log}"
SSHD_PID="${QUAKE_SSHD_PID:-/tmp/quake-sshd.pid}"
NGROK_PID="${QUAKE_NGROK_PID:-/tmp/quake-ngrok.pid}"

log() { printf '[quake-ssh] %s\n' "$*"; }
warn() { printf '[quake-ssh][WARN] %s\n' "$*" >&2; }
die() { printf '[quake-ssh][ERROR] %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die 'root olarak çalıştırın.'
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] || die "SSH_PORT sayı olmalı: $SSH_PORT"

find_bin() {
  command -v "$1" 2>/dev/null || true
}

SSHD_BIN="${SSHD_BIN:-$(find_bin sshd)}"
[[ -n "$SSHD_BIN" ]] || SSHD_BIN="$(find_bin /usr/sbin/sshd)"
[[ -x "$SSHD_BIN" ]] || die 'sshd bulunamadı. OpenSSH server paketini kurun.'

if ! command -v "$NGROK_BIN" >/dev/null 2>&1 && [[ ! -x "$NGROK_BIN" ]]; then
  die "ngrok bulunamadı: $NGROK_BIN"
fi

log "Sunucu: $(hostname 2>/dev/null || printf unknown)"
log "UTC zaman: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
log "sshd: $SSHD_BIN"
log "ngrok: $NGROK_BIN"

mkdir -p /run/sshd /var/run/sshd 2>/dev/null || true
if command -v ssh-keygen >/dev/null 2>&1; then
  ssh-keygen -A >/dev/null 2>&1 || warn 'host anahtarları oluşturulamadı; mevcut anahtarlar kullanılacak.'
fi

BASE_CONFIG="/etc/ssh/sshd_config"
[[ -f "$BASE_CONFIG" ]] || die "$BASE_CONFIG yok."

# Validate the real config first. This catches missing host keys, bad Include
# paths, and syntax errors before a tunnel is started.
if ! "$SSHD_BIN" -t -f "$BASE_CONFIG" 2>"$SSHD_LOG"; then
  warn "sshd mevcut yapılandırmayla doğrulanamadı; log: $SSHD_LOG"
  sed -n '1,80p' "$SSHD_LOG" >&2 || true
  die 'Önce /etc/ssh/sshd_config hatasını düzeltin.'
fi

if [[ "$ENABLE_ROOT_PASSWORD" == "1" ]]; then
  warn 'Geçici root/parola SSH override etkin. İş bitince sshd''yi kapatın.'
  SSHD_OVERRIDES=(
    -o PermitRootLogin=yes
    -o PasswordAuthentication=yes
    -o PubkeyAuthentication=no
    -o ChallengeResponseAuthentication=no
    -o UsePAM=yes
  )
else
  # Use the real config by default; do not weaken authentication automatically.
  SSHD_OVERRIDES=()
fi

if ! "$SSHD_BIN" -t -f "$BASE_CONFIG" -o "Port=$SSH_PORT" -o "PidFile=$SSHD_PID" "${SSHD_OVERRIDES[@]}" 2>"$SSHD_LOG"; then
  warn "Kullanılacak sshd config doğrulanamadı; log: $SSHD_LOG"
  sed -n '1,80p' "$SSHD_LOG" >&2 || true
  die 'sshd config doğrulaması başarısız.'
fi

port_open() {
  if command -v ss >/dev/null 2>&1; then
    ss -H -ltn 2>/dev/null | awk -v p=":$SSH_PORT" '$4 ~ p"$" { found=1 } END { exit(found ? 0 : 1) }'
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk -v p=":$SSH_PORT" '$4 ~ p"$" { found=1 } END { exit(found ? 0 : 1) }'
  else
    return 1
  fi
}

if port_open; then
  log "TCP $SSH_PORT zaten dinleniyor."
else
  rm -f -- "$SSHD_PID" 2>/dev/null || true
  nohup "$SSHD_BIN" -D -e -f "$BASE_CONFIG" -p "$SSH_PORT" -o "PidFile=$SSHD_PID" "${SSHD_OVERRIDES[@]}" </dev/null >"$SSHD_LOG" 2>&1 &
  SSHD_CHILD=$!
  printf '%s\n' "$SSHD_CHILD" >"$SSHD_PID"
  for _ in $(seq 1 20); do
    if port_open; then break; fi
    if ! kill -0 "$SSHD_CHILD" 2>/dev/null; then
      warn "sshd hemen kapandı; log: $SSHD_LOG"
      sed -n '1,120p' "$SSHD_LOG" >&2 || true
      die 'sshd başlatılamadı.'
    fi
    sleep 0.25
  done
  port_open || die "sshd $SSH_PORT portunu dinlemiyor. Log: $SSHD_LOG"
  log "sshd başlatıldı (PID $SSHD_CHILD)."
fi

local_probe=''
if command -v nc >/dev/null 2>&1; then
  local_probe="$(nc -z -w 2 127.0.0.1 "$SSH_PORT" 2>&1 && printf ok || printf failed)"
elif command -v bash >/dev/null 2>&1; then
  if bash -c "</dev/tcp/127.0.0.1/$SSH_PORT" >/dev/null 2>&1; then local_probe=ok; else local_probe=failed; fi
fi
[[ "$local_probe" == ok ]] && log "Yerel SSH TCP probe: OK" || warn "Yerel SSH TCP probe başarısız."

ngrok_running=0
if [[ -f "$NGROK_PID" ]]; then
  ngrok_pid="$(cat "$NGROK_PID" 2>/dev/null || true)"
  if [[ "$ngrok_pid" =~ ^[0-9]+$ ]] && kill -0 "$ngrok_pid" 2>/dev/null; then ngrok_running=1; fi
fi
if [[ "$ngrok_running" -eq 0 ]] && pgrep -af "$NGROK_BIN.*tcp" >/dev/null 2>&1; then ngrok_running=1; fi

if [[ "$ngrok_running" -eq 0 && "$NGROK_AUTOSTART" == "1" ]]; then
  : >"$NGROK_LOG"
  nohup "$NGROK_BIN" tcp "$SSH_PORT" --log=stdout </dev/null >"$NGROK_LOG" 2>&1 &
  NGROK_CHILD=$!
  printf '%s\n' "$NGROK_CHILD" >"$NGROK_PID"
  log "ngrok başlatıldı (PID $NGROK_CHILD); adres bekleniyor…"
  sleep 2
else
  log "Çalışan ngrok TCP süreci bulundu; yeni süreç başlatılmadı."
fi

forwarding="$(grep -Eo 'tcp://[^[:space:]]+' "$NGROK_LOG" 2>/dev/null | tail -n 1 || true)"
if [[ -n "$forwarding" ]]; then
  log "NGROK_FORWARDING=$forwarding"
  log "SSH komutu: ssh root@${forwarding#tcp://}"
else
  warn "ngrok forwarding adresi logda bulunamadı: $NGROK_LOG"
  sed -n '1,80p' "$NGROK_LOG" >&2 || true
fi

report_expiry() {
  printf '\n===== EXPIRY RAPORU =====\n'
  printf 'Kontrol zamanı (UTC): %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  if command -v chage >/dev/null 2>&1; then
    printf '\n[root hesap süresi]\n'
    chage -l root 2>/dev/null | sed -n '/Last password change/;/Password expires/;/Account expires/;/Password inactive/p' || true
  fi

  printf '\n[TLS sertifikaları]\n'
  cert_found=0
  for cert in /etc/letsencrypt/live/*/cert.pem /etc/ssl/certs/*.pem; do
    [[ -f "$cert" ]] || continue
    cert_found=1
    enddate="$(openssl x509 -noout -enddate -in "$cert" 2>/dev/null | sed 's/^notAfter=//' || true)"
    [[ -n "$enddate" ]] && printf '%s -> %s\n' "$cert" "$enddate"
  done
  [[ "$cert_found" -eq 1 ]] || printf 'Bulunamadı.\n'

  printf '\n[expiry/license dosya adayları]\n'
  find /etc /opt /root -xdev -maxdepth 4 -type f \( -iname '*expir*' -o -iname '*license*' -o -iname '*renew*' -o -iname '*subscription*' \) -printf '%p\n' 2>/dev/null | head -n 80 || true
  printf '\nNot: “sunucu exp” standart bir Linux alanı değildir; bu rapor hesap, TLS ve lisans/yenileme adaylarını gösterir.\n'
}

report_expiry
log "Tamamlandı. SSH/ngrok logları: $SSHD_LOG ve $NGROK_LOG"
