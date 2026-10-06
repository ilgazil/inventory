#!/usr/bin/env bash
# Crée backend/.env sur le serveur Example (à lancer une seule fois).
# Les secrets sont saisis ici et écrits directement sur le serveur — rien ne passe par le repo.
# Le mot de passe SSH vient du trousseau macOS (cf. deploy.sh).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .deploy.env ]]; then
  echo "❌ .deploy.env manquant." >&2
  exit 1
fi
# shellcheck disable=SC1091
source .deploy.env

: "${PROD_HOST:?}"; : "${PROD_SSH_USER:?}"; : "${PROD_PATH:?}"; PROD_PORT="${PROD_PORT:-22}"

echo "=== Création de ${PROD_PATH}/.env sur ${PROD_HOST} ==="
read -rp "Hôte MariaDB Example (ex. xxx.myd.example.com) : " DB_HOST
read -rp "Port MariaDB [3306] : " DB_PORT
DB_PORT="${DB_PORT:-3306}"
read -rp "Utilisateur DB : " DB_USER
read -rsp "Mot de passe DB : " DB_PASSWORD
echo ""
read -rp "Nom de la base [REDACTED] : " DB_NAME
DB_NAME="${DB_NAME:-REDACTED}"
read -rsp "Mot de passe de connexion à l'app (login inventaire) : " APP_PASSWORD
echo ""

if [[ -z "${DB_HOST}" || -z "${DB_USER}" || -z "${DB_PASSWORD}" || -z "${APP_PASSWORD}" ]]; then
  echo "❌ Hôte, utilisateur, mot de passe DB et mot de passe app sont requis." >&2
  exit 1
fi

JWT_SECRET="$(openssl rand -hex 32)"
AUTH_PASSWORD_HASH="$(node backend/scripts/hash-password.mjs "${APP_PASSWORD}")"

export SSHPASS=""
RUN_SSH="ssh"
if command -v sshpass >/dev/null 2>&1 && security find-generic-password -s inventory-deploy -a "${PROD_SSH_USER}" >/dev/null 2>&1; then
  SSHPASS="$(security find-generic-password -s inventory-deploy -a "${PROD_SSH_USER}" -w)"
  export SSHPASS
  RUN_SSH="sshpass -e ssh"
fi

# L'app vit à la racine du site (dossier d'exécution du Manager) : .env à côté de package.json.
# Variables DB discrètes : un mot de passe avec %, @ ou : passe sans encodage.
$RUN_SSH -p "${PROD_PORT}" "${PROD_SSH_USER}@${PROD_HOST}" "cat > ${PROD_PATH}/.env" <<EOF
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
JWT_SECRET=${JWT_SECRET}
AUTH_PASSWORD_HASH=${AUTH_PASSWORD_HASH}
NODE_ENV=production
EOF

echo "✅ .env créé à la racine du site (chmod 600)."
$RUN_SSH -p "${PROD_PORT}" "${PROD_SSH_USER}@${PROD_HOST}" "chmod 600 ${PROD_PATH}/.env && ls -l ${PROD_PATH}/.env"
echo "→ Redémarre ensuite le site dans le Manager Example."
