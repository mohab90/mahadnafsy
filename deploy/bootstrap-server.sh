#!/usr/bin/env bash
# One-time server preparation, run as root on a fresh host.
#
# deploy/README_AR.md describes this layout in prose but nothing created it, so
# the first activation failed on a host that looked ready. Safe to re-run: every
# step is idempotent and it never touches an existing api.env or release.
#
#   sudo bash bootstrap-server.sh "ssh-ed25519 AAAA... mahad-deploy"
#
# The argument is the deploy public key. It is authorised for `mahad` only —
# activation escalates through sudo, so nothing here needs a root login.
set -euo pipefail

DEPLOY_KEY="${1:-}"
SERVICE_USER="mahad"

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 77; }
if [[ -z "$DEPLOY_KEY" ]]; then
  echo "usage: bootstrap-server.sh \"<ssh public key>\"" >&2
  exit 64
fi
[[ "$DEPLOY_KEY" == ssh-* ]] || { echo "that does not look like an SSH public key" >&2; exit 64; }

# ── Service account ──────────────────────────────────────────────────────────
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$SERVICE_USER"
  echo "created user $SERVICE_USER"
fi

install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "/home/$SERVICE_USER/.ssh"
AUTH="/home/$SERVICE_USER/.ssh/authorized_keys"
touch "$AUTH"
grep -qxF "$DEPLOY_KEY" "$AUTH" || echo "$DEPLOY_KEY" >> "$AUTH"
chmod 0600 "$AUTH"
chown "$SERVICE_USER:$SERVICE_USER" "$AUTH"

# ── Layout ───────────────────────────────────────────────────────────────────
# Release directories stay root-owned: a compromised app account must not be
# able to rewrite the code it is about to run. Only data and cache are writable
# by the service, which is the split README_AR.md asks for.
install -d -m 0755 /opt/mahad /opt/mahad/releases /opt/mahad/static /opt/mahad/static/releases
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" /var/lib/mahad /var/cache/mahad
install -d -m 0750 /etc/mahad
install -d -m 0755 /staging

# ── Production environment file ──────────────────────────────────────────────
# Created empty if absent so activation fails with "readiness" rather than
# "missing file", which is the more useful message. Never overwritten.
if [[ ! -f /etc/mahad/api.env ]]; then
  umask 077
  cat > /etc/mahad/api.env <<'ENV'
# Production configuration. See api/.env.example for the complete list.
# Secrets belong in a Secret Manager and should be mounted as *_FILE paths.
# Activation runs readiness:production:live and refuses to deploy until this
# file is complete.
ENV
  chmod 0640 /etc/mahad/api.env
  echo "created /etc/mahad/api.env (empty — fill it before deploying)"
fi

# ── systemd unit ─────────────────────────────────────────────────────────────
UNIT_SRC="$(dirname "$(realpath "${BASH_SOURCE[0]}")")/systemd/mahad-api.service"
if [[ -f "$UNIT_SRC" ]]; then
  install -m 0644 "$UNIT_SRC" /etc/systemd/system/mahad-api.service
  systemctl daemon-reload
  systemctl enable mahad-api.service >/dev/null 2>&1 || true
  echo "installed mahad-api.service"
else
  echo "note: systemd unit not found next to this script; install it manually" >&2
fi

# ── Passwordless sudo for the two activation scripts only ────────────────────
cat > /etc/sudoers.d/mahad-deploy <<SUDO
$SERVICE_USER ALL=(root) NOPASSWD: /usr/bin/bash /staging/activate-release.sh *, /usr/bin/bash /staging/activate-static-release.sh *
SUDO
chmod 0440 /etc/sudoers.d/mahad-deploy
visudo -cf /etc/sudoers.d/mahad-deploy >/dev/null

echo
echo "server prepared."
echo "next: fill /etc/mahad/api.env, then run push-release.sh from the repo."
