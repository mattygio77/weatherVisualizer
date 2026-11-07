#!/bin/bash
# Sync files to Synology NAS for Container Manager Project
# Usage: ./scripts/deploy_to_nas.sh <NAS_IP> <NAS_USER> [SSH_KEY]

set -e

NAS_IP="${1:-${NAS_HOST}}"
NAS_USER="${2:-${NAS_USER}}"
KEY_ARG=""

if [ -z "$NAS_IP" ] || [ -z "$NAS_USER" ]; then
  echo "Usage: ./scripts/deploy_to_nas.sh <NAS_IP> <NAS_USER> [SSH_KEY_PATH]"
  echo "Example: ./scripts/deploy_to_nas.sh 192.168.1.50 admin ~/.ssh/id_ed25519"
  exit 1
fi

if [ -n "$3" ]; then
  KEY_ARG="-i $3"
elif [ -f "$(dirname "$0")/../.nas_key" ]; then
  KEY_ARG="-i $(dirname "$0")/../.nas_key"
fi

TARGET_DIR="/volume1/docker/weather-station"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "================================================================="
echo " Syncing AcuRite Weather Station files to Synology NAS"
echo " Target: ${NAS_USER}@${NAS_IP}:${TARGET_DIR}"
echo "================================================================="

# 1. Create target directories on NAS (try without sudo first, fallback to sudo with TTY if needed)
echo "📁 Ensuring target directories exist on NAS..."
if ! ssh -o StrictHostKeyChecking=no $KEY_ARG "${NAS_USER}@${NAS_IP}" "mkdir -p ${TARGET_DIR}/data ${TARGET_DIR}/pi-ingest ${TARGET_DIR}/nas-webapp" 2>/dev/null; then
  echo "   (Root permission required on /volume1/docker, prompting for sudo password...)"
  ssh -t -o StrictHostKeyChecking=no $KEY_ARG "${NAS_USER}@${NAS_IP}" \
    "sudo mkdir -p ${TARGET_DIR}/data ${TARGET_DIR}/pi-ingest ${TARGET_DIR}/nas-webapp && sudo chown -R ${NAS_USER} ${TARGET_DIR}"
fi

# 2. Transfer project files to NAS via tar stream
# Note: docker-compose.all-on-nas.yml is staged as both its original name and docker-compose.yml
# so Synology Container Manager automatically detects it as the active compose file.
echo "📦 Transferring project files to NAS..."
cd "$REPO_DIR"

tar --exclude='node_modules' --exclude='.git' --exclude='.svelte-kit' --exclude='build' --exclude='data' -czf - \
  docker-compose.all-on-nas.yml \
  docker-compose.yml \
  pi-ingest \
  nas-webapp | \
  ssh -o StrictHostKeyChecking=no $KEY_ARG "${NAS_USER}@${NAS_IP}" "tar -xzf - -C ${TARGET_DIR} && cp ${TARGET_DIR}/docker-compose.all-on-nas.yml ${TARGET_DIR}/docker-compose.yml"

# 3. Clean up any obsolete .env files and set persistent pin.txt
echo "🧹 Cleaning up any obsolete .env files on NAS..."
ssh -o StrictHostKeyChecking=no $KEY_ARG "${NAS_USER}@${NAS_IP}" "rm -f ${TARGET_DIR}/.env ${TARGET_DIR}/.env.example"

echo "🔑 Ensuring active PIN (789789) is set in ${TARGET_DIR}/data/pin.txt..."
ssh -o StrictHostKeyChecking=no $KEY_ARG "${NAS_USER}@${NAS_IP}" "echo -n '789789' > ${TARGET_DIR}/data/pin.txt"

echo "================================================================="
echo " Sync complete! Files are staged at ${TARGET_DIR}."
echo " Ready for Synology Container Manager."
echo "================================================================="
