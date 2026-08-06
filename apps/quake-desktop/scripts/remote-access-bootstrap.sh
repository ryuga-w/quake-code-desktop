#!/usr/bin/env bash
set -Eeuo pipefail

# Quake Code: ngrok-independent remote access bootstrap.
#
# This script is intended to be run by an agent on the Linux server as root.
# It is idempotent: it does not kill an existing sshd, does not change the
# root password, and never prints secret environment values.
#
# Recommended first run (Tailscale, no public SSH port required):
#   MODE=tailscale bash remote-access-bootstrap.sh
#
# If Tailscale is not installed and you explicitly want the script to install
# it through the vendor installer:
#   MODE=tailscale INSTALL_TAILSCALE=1 bash remote-access-bootstrap.sh
#
# Other modes:
#   MODE=diagnose bash remote-access-bootstrap.sh
#   MODE=direct PUBLIC_HOST=203.0.113.10 bash remote-access-bootstrap.sh
#   MODE=reverse REVERSE_TARGET=user@relay.example REVERSE_REMOTE_PORT=22022 bash remote-access-bootstrap.sh
#
# Optional variables:
#   SSH_PORT=22                 Local sshd port (default 22).
#   SSH_CONFIG=/etc/ssh/sshd_config
#   SSH_ALLOW_ROOT_PASSWORD=0  Do not weaken auth by default; set to 1 only
#                               if the server already has a temporary password.
#   INSTALL_TAILSCALE=0         Install Tailscale only when explicitly 1.
#   TAILSCALE_AUTH_KEY=...       Optional one-time Tailscale auth key; never logged.
#   TAILSCALE_USERSPACE=1        Run without /dev/net/tun/iptables (default 1).
#   TAILSCALE_SERVE_SSH=1        Proxy tailnet TCP port to local sshd (default 1).
#   PUBLIC_HOST=...              Public IP/DNS for MODE=direct output.
#   OPEN_FIREWALL=0             Never modify firewall unless explicitly 1.
#   REVERSE_KEY=/path/key       Optional key for MODE=reverse.

MODE="${MODE:-diagnose}"
SSH_PORT="${SSH_PORT:-22}"
SSH_CONFIG="${SSH_CONFIG:-/etc/ssh/sshd_config}"
SSH_ALLOW_ROOT_PASSWORD="${SSH_ALLOW_ROOT_PASSWORD:-0}"
INSTALL_TAILSCALE="${INSTALL_TAILSCALE:-0}"
TAILSCALE_USERSPACE="${TAILSCALE_USERSPACE:-1}"
TAILSCALE_SERVE_SSH="${TAILSCALE_SERVE_SSH:-1}"
OPEN_FIREWALL="${OPEN_FIREWALL:-0}"
TAILSCALE_AUTH_KEY="${TAILSCALE_AUTH_KEY:-}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
REVERSE_TARGET="${REVERSE_TARGET:-}"
REVERSE_REMOTE_PORT="${REVERSE_REMOTE_PORT:-}"
REVERSE_KEY="${REVERSE_KEY:-}"

STATE_DIR="${QUAKE_REMOTE_STATE_DIR:-/var/lib/quake-remote}"
RUN_DIR="${QUAKE_REMOTE_RUN_DIR:-/run/quake-remote}"
SSHD_LOG="$RUN_DIR/sshd.log"
TAILSCALE_LOG="$RUN_DIR/tailscaled.log"
REVERSE_LOG="$RUN_DIR/reverse-ssh.log"
SSHD_PID="$RUN_DIR/sshd.pid"
TAILSCALED_PID="$RUN_DIR/tailscaled.pid"
REVERSE_PID="$RUN_DIR/reverse-ssh.pid"

log() { printf '[quake-remote] %s\n' "$*"; }
warn() { printf '[quake-remote][WARN] %s\n' "$*" >&2; }
die() { printf '[quake-remote][ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '1,42p' "$0"
}

[[ "$(id -u)" -eq 0 ]] || die 'Bu script root olarak çalıştırılmalı.'
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] || die "SSH_PORT sayı olmalı: $SSH_PORT"
[[ "$MODE" =~ ^(diagnose|tailscale|direct|reverse)$ ]] || { usage; die "Bilinmeyen MODE: $MODE"; }
[[ -f "$SSH_CONFIG" ]] || die "sshd config bulunamadı: $SSH_CONFIG"

mkdir -p "$STATE_DIR" "$RUN_DIR" /run/sshd /var/run/sshd 2>/dev/null || true
chmod 700 "$STATE_DIR" "$RUN_DIR" 2>/dev/null || true

find_bin() { command -v "$1" 2>/dev/null || true; }
SSHD_BIN="$(find_bin sshd)"
[[ -x "$SSHD_BIN" ]] || SSHD_BIN="/usr/sbin/sshd"
[[ -x "$SSHD_BIN" ]] || die 'sshd bulunamadı. OpenSSH server paketini kurun.'

if command -v ssh-keygen >/dev/null 2>&1; then
  ssh-keygen -A >/dev/null 2>&1 || warn 'Eksik SSH host anahtarı üretilemedi.'
fi

validate_sshd() {
  if ! "$SSHD_BIN" -t -f "$SSH_CONFIG" 2>"$SSHD_LOG"; then
    warn "sshd config geçersiz: $SSHD_LOG"
    sed -n '1,100p' "$SSHD_LOG" >&2 || true
    return 1
  fi
}

listener_info() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | awk -v p=":$SSH_PORT" 'NR == 1 || $4 ~ p"$"'
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltnp 2>/dev/null | awk -v p=":$SSH_PORT" 'NR == 1 || $4 ~ p"$"'
  else
    printf 'ss/netstat yok; listener ayrıntısı alınamadı.\n'
  fi
}

port_open() {
  if command -v ss >/dev/null 2>&1; then
    ss -H -ltn 2>/dev/null | awk -v p=":$SSH_PORT" '$4 ~ p"$" { ok=1 } END { exit(ok ? 0 : 1) }'
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk -v p=":$SSH_PORT" '$4 ~ p"$" { ok=1 } END { exit(ok ? 0 : 1) }'
  else
    bash -c "</dev/tcp/127.0.0.1/$SSH_PORT" >/dev/null 2>&1
  fi
}

ssh_banner_ok() {
  command -v ssh-keyscan >/dev/null 2>&1 || return 1
  timeout 6 ssh-keyscan -T 5 -p "$SSH_PORT" 127.0.0.1 2>/dev/null | grep -q '^127\.0\.0\.1 '
}

start_sshd_if_needed() {
  validate_sshd || die 'sshd config düzeltilmeden devam edemem.'

  if port_open; then
    if ssh_banner_ok; then
      log "SSH $SSH_PORT zaten çalışıyor; mevcut süreç korunuyor."
      return 0
    fi
    warn "TCP $SSH_PORT dolu ama SSH host anahtarı yanıtı alınamadı. Mevcut süreci öldürmüyorum."
    listener_info
    return 1
  fi

  local -a overrides=()
  if [[ "$SSH_ALLOW_ROOT_PASSWORD" == "1" ]]; then
    warn 'Geçici root/parola override etkin; bu yalnızca mevcut parola zaten ayarlıysa çalışır.'
    overrides=(
      -o PermitRootLogin=yes
      -o PasswordAuthentication=yes
      -o PubkeyAuthentication=no
      -o ChallengeResponseAuthentication=no
      -o UsePAM=yes
    )
  fi

  rm -f -- "$SSHD_PID" 2>/dev/null || true
  nohup "$SSHD_BIN" -D -e -f "$SSH_CONFIG" -p "$SSH_PORT" -o "PidFile=$SSHD_PID" "${overrides[@]}" </dev/null >"$SSHD_LOG" 2>&1 &
  local child=$!
  printf '%s\n' "$child" >"$SSHD_PID"

  for _ in $(seq 1 30); do
    if port_open && ssh_banner_ok; then
      log "sshd başlatıldı: PID=$child, port=$SSH_PORT"
      return 0
    fi
    if ! kill -0 "$child" 2>/dev/null; then
      warn "sshd kapanmış; log: $SSHD_LOG"
      sed -n '1,120p' "$SSHD_LOG" >&2 || true
      return 1
    fi
    sleep 0.25
  done

  warn "sshd portu/bannerı hazır olmadı; log: $SSHD_LOG"
  listener_info
  return 1
}

fingerprint() {
  local key
  key="$(timeout 6 ssh-keyscan -T 5 -p "$SSH_PORT" 127.0.0.1 2>/dev/null | head -n 1 || true)"
  if [[ -n "$key" ]] && command -v ssh-keygen >/dev/null 2>&1; then
    printf '%s\n' "$key" | ssh-keygen -lf - 2>/dev/null || true
  fi
}

report_expiry() {
  printf '\n===== EXPIRY RAPORU =====\n'
  printf 'Kontrol zamanı UTC: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'Sunucu: %s\n' "$(hostname 2>/dev/null || printf unknown)"

  printf '\n[root hesap süresi]\n'
  if command -v chage >/dev/null 2>&1; then
    chage -l root 2>/dev/null | sed -n '/Last password change/;/Password expires/;/Account expires/;/Password inactive/p' || true
  else
    printf 'chage bulunamadı.\n'
  fi

  printf '\n[TLS sertifikaları]\n'
  local found=0 enddate
  while IFS= read -r -d '' cert; do
    found=1
    enddate="$(openssl x509 -noout -enddate -in "$cert" 2>/dev/null | sed 's/^notAfter=//' || true)"
    [[ -n "$enddate" ]] && printf '%s -> %s\n' "$cert" "$enddate"
  done < <(find /etc/letsencrypt /etc/ssl -xdev -type f \( -name '*.pem' -o -name '*.crt' \) -print0 2>/dev/null)
  [[ "$found" -eq 1 ]] || printf 'Sertifika bulunamadı.\n'

  printf '\n[expiry/license dosya adayları]\n'
  find /etc /opt /root -xdev -maxdepth 4 -type f \( -iname '*expir*' -o -iname '*license*' -o -iname '*renew*' -o -iname '*subscription*' \) -printf '%p\n' 2>/dev/null | head -n 80 || true
  printf '\nNot: “sunucu exp” Linuxta standart tek bir alan değildir; yukarıdaki hesap, TLS ve lisans adayları raporlanır.\n'
}

tailscale_up() {
  local ts tsd socket state_file status ip
  ts="$(find_bin tailscale)"
  if [[ -z "$ts" ]]; then
    if [[ "$INSTALL_TAILSCALE" != "1" ]]; then
      warn 'Tailscale kurulu değil. Kurmak için INSTALL_TAILSCALE=1 ile tekrar çalıştırın.'
      printf 'Kurulum: curl -fsSL https://tailscale.com/install.sh | sh\n'
      return 10
    fi
    command -v curl >/dev/null 2>&1 || die 'Tailscale kurulumu için curl gerekli.'
    log 'Tailscale kuruluyor (INSTALL_TAILSCALE=1 açık)…'
    curl -fsSL https://tailscale.com/install.sh | sh
    ts="$(find_bin tailscale)"
  fi

  tsd="$(find_bin tailscaled)"
  [[ -x "$tsd" ]] || tsd="/usr/sbin/tailscaled"
  [[ -x "$tsd" ]] || die 'tailscaled daemon bulunamadı.'

  socket="${TAILSCALE_SOCKET:-/var/run/tailscale/tailscaled.sock}"
  # Reuse the package/default state so an already-authorized node can restart
  # without generating or exposing another auth key.
  state_file="${TAILSCALE_STATE_FILE:-/var/lib/tailscale/tailscaled.state}"
  mkdir -p "$(dirname "$socket")" "$(dirname "$state_file")"

  if ! "$ts" --socket="$socket" status >/dev/null 2>&1; then
    if [[ -f "$TAILSCALED_PID" ]] && kill -0 "$(cat "$TAILSCALED_PID" 2>/dev/null || printf 0)" 2>/dev/null; then
      warn "tailscaled çalışıyor fakat socket hazır değil: $socket"
    else
      local -a daemon_args=(
        --state="$state_file"
        --socket="$socket"
      )
      if [[ "$TAILSCALE_USERSPACE" == "1" ]]; then
        daemon_args+=(
          --tun=userspace-networking
          --socks5-server=127.0.0.1:1055
        )
      fi

      nohup "$tsd" "${daemon_args[@]}" </dev/null >"$TAILSCALE_LOG" 2>&1 &
      printf '%s\n' "$!" >"$TAILSCALED_PID"
    fi

    for _ in $(seq 1 40); do
      [[ -S "$socket" ]] && break
      sleep 0.25
    done
    [[ -S "$socket" ]] || {
      warn "tailscaled socket oluşmadı: $socket"
      sed -n '1,120p' "$TAILSCALE_LOG" >&2 || true
      return 12
    }
  fi

  local -a ts_cmd=("$ts" --socket="$socket")
  status="$("${ts_cmd[@]}" status 2>&1 || true)"
  if [[ "$status" != *"Logged in"* && "$status" != *"100."* && "$status" != *"active"* ]]; then
    if [[ -n "$TAILSCALE_AUTH_KEY" ]]; then
      # The key is passed directly to tailscale and is never echoed.
      "${ts_cmd[@]}" up --auth-key="$TAILSCALE_AUTH_KEY" --accept-dns=false --ssh=false >/dev/null
    else
      warn 'Tailscale kurulu fakat bu makine ağa bağlı değil.'
      printf 'İnteraktif: tailscale --socket=%s up --accept-dns=false --ssh=false\n' "$socket"
      printf 'Otomatik: TAILSCALE_AUTH_KEY=... MODE=tailscale bash %s\n' "$0"
      return 11
    fi
  fi

  ip="$("${ts_cmd[@]}" ip -4 2>/dev/null | head -n 1 || true)"
  [[ -n "$ip" ]] || { warn 'Tailscale IPv4 adresi alınamadı.'; return 12; }

  if [[ "$TAILSCALE_USERSPACE" == "1" && "$TAILSCALE_SERVE_SSH" == "1" ]]; then
    # In userspace mode there is no kernel tailscale0 interface. Explicitly
    # proxy tailnet TCP/$SSH_PORT to the verified localhost sshd listener.
    "${ts_cmd[@]}" serve --bg --tcp="$SSH_PORT" "tcp://127.0.0.1:$SSH_PORT" >/dev/null
    log "Tailscale Serve: tailnet TCP/$SSH_PORT -> localhost:$SSH_PORT"
  fi

  printf '\nTAILSCALE_SSH=ssh root@%s -p %s\n' "$ip" "$SSH_PORT"
  printf 'Bu yol ngrok/public port açmaz; istemci aynı Tailscale ağına bağlı olmalı.\n'
  return 0
}

direct_report() {
  local host="$PUBLIC_HOST"
  if [[ -z "$host" ]] && command -v curl >/dev/null 2>&1; then
    host="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  fi
  printf '\nDIRECT_SSH=ssh root@%s -p %s\n' "${host:-SUNUCU_PUBLIC_IP}" "$SSH_PORT"
  printf 'Bu yol için bulut güvenlik grubu/firewall TCP %s izni gerekir.\n' "$SSH_PORT"
  if [[ "$OPEN_FIREWALL" == "1" ]]; then
    warn 'OPEN_FIREWALL=1 açık; yalnızca mevcut firewall yöneticisi bulunursa kural ekleniyor.'
    if command -v ufw >/dev/null 2>&1; then ufw allow "$SSH_PORT/tcp"; fi
    if command -v firewall-cmd >/dev/null 2>&1; then firewall-cmd --permanent --add-port="$SSH_PORT/tcp"; firewall-cmd --reload; fi
  fi
}

reverse_report() {
  [[ -n "$REVERSE_TARGET" ]] || { warn 'MODE=reverse için REVERSE_TARGET=user@relay gerekli.'; return 20; }
  [[ "$REVERSE_REMOTE_PORT" =~ ^[0-9]+$ ]] || { warn 'MODE=reverse için REVERSE_REMOTE_PORT sayı gerekli.'; return 20; }
  command -v ssh >/dev/null 2>&1 || die 'reverse SSH için ssh gerekli.'

  local -a key_args=()
  [[ -n "$REVERSE_KEY" ]] && key_args=(-i "$REVERSE_KEY")
  if [[ -f "$REVERSE_PID" ]] && kill -0 "$(cat "$REVERSE_PID" 2>/dev/null || printf 0)" 2>/dev/null; then
    log 'Reverse SSH zaten çalışıyor.'
  else
    nohup ssh "${key_args[@]}" -N -T \
      -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -R "127.0.0.1:${REVERSE_REMOTE_PORT}:127.0.0.1:${SSH_PORT}" \
      "$REVERSE_TARGET" </dev/null >"$REVERSE_LOG" 2>&1 &
    printf '%s\n' "$!" >"$REVERSE_PID"
    sleep 1
  fi
  printf '\nREVERSE_SSH_ON_RELAY=ssh root@127.0.0.1 -p %s\n' "$REVERSE_REMOTE_PORT"
  printf 'Relay üzerinde GatewayPorts gerekmez; bağlantı relay localhostundan yapılır.\n'
  [[ -s "$REVERSE_LOG" ]] && sed -n '1,40p' "$REVERSE_LOG" >&2 || true
}

log "MODE=$MODE SSH_PORT=$SSH_PORT"
start_sshd_if_needed || die "SSH hazır değil. Log: $SSHD_LOG"
log 'Yerel SSH bannerı doğrulandı.'
fingerprint

case "$MODE" in
  diagnose) : ;;
  tailscale) tailscale_up ;;
  direct) direct_report ;;
  reverse) reverse_report ;;
esac

report_expiry
log "Tamamlandı. SSH logu: $SSHD_LOG"
