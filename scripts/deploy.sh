#!/usr/bin/env bash
# Déploiement vers le serveur de production — cf. .deploy.env
#
# Authentification SSH (certains hébergeurs de sites Node.js ne supportent pas la clé SSH) :
#   1. mot de passe dans le trousseau macOS : security add-generic-password -s inventory-deploy -a "<user>" -w
#   2. sinon PROD_SSH_PASSWORD dans .deploy.env (en clair, gitignoré)
#   3. sinon : mot de passe demandé interactivement par ssh/rsync
#
# Usage : scripts/deploy.sh [--dry-run]
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .deploy.env ]]; then
  echo "❌ .deploy.env manquant — commence par : cp .deploy.env.example .deploy.env" >&2
  exit 1
fi
# shellcheck disable=SC1091
source .deploy.env

: "${PROD_HOST:?PROD_HOST manquant}"
: "${PROD_SSH_USER:?PROD_SSH_USER manquant}"
: "${PROD_PATH:?PROD_PATH manquant}"
PROD_PORT="${PROD_PORT:-22}"

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "=== Simulation de déploiement (rien ne sera envoyé) ==="
fi

# Arbre git propre exigé pour un vrai déploiement (comme `listen`) — SKIP_GIT_CHECK=1 pour ignorer.
if [[ -z "$DRY_RUN" ]] && [[ "${SKIP_GIT_CHECK:-0}" != "1" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "❌ Arbre git non propre — committe ou stash avant de déployer (SKIP_GIT_CHECK=1 pour ignorer)." >&2
  exit 1
fi

# Le build du frontend doit exister (make build).
if [[ ! -f backend/public/index.html ]]; then
  echo "❌ backend/public/index.html absent — lance 'make build' d'abord." >&2
  exit 1
fi

# Les dépendances doivent être installées (elles sont envoyées telles quelles : 100 % JS purs).
if [[ ! -d backend/node_modules ]]; then
  echo "❌ backend/node_modules absent — lance 'make install' d'abord." >&2
  exit 1
fi

# Authentification SSH : sshpass si un mot de passe est disponible (trousseau puis .env).
# NB : sshpass enveloppe rsync/ssh directement (pas « rsync -e "sshpass …" » — l'env ne
# traverse pas le spawn interne d'openrsync de macOS).
RUN_SSH="ssh"
RUN_RSYNC="rsync"
if command -v sshpass >/dev/null 2>&1; then
  if security find-generic-password -s inventory-deploy -a "${PROD_SSH_USER}" >/dev/null 2>&1; then
    export SSHPASS="$(security find-generic-password -s inventory-deploy -a "${PROD_SSH_USER}" -w)"
    RUN_SSH="sshpass -e ssh"
    RUN_RSYNC="sshpass -e rsync"
    echo "→ Mot de passe SSH depuis le trousseau macOS."
  elif [[ -n "${PROD_SSH_PASSWORD:-}" ]]; then
    export SSHPASS="${PROD_SSH_PASSWORD}"
    RUN_SSH="sshpass -e ssh"
    RUN_RSYNC="sshpass -e rsync"
    echo "→ Mot de passe SSH depuis .deploy.env (en clair — privilégie le trousseau macOS)."
  fi
elif [[ -n "${PROD_SSH_PASSWORD:-}" ]]; then
  echo "⚠️  PROD_SSH_PASSWORD défini mais sshpass absent — mot de passe demandé interactivement." >&2
fi

SSH_CMD="ssh -p ${PROD_PORT}"
DEST="${PROD_SSH_USER}@${PROD_HOST}"

echo "→ ${DEST}:${PROD_PATH} (${PROD_URL:-url non renseignée})"

$RUN_RSYNC $DRY_RUN -az --delete -e "$SSH_CMD" backend/src/ "${DEST}:${PROD_PATH}/src/"
$RUN_RSYNC $DRY_RUN -az -e "$SSH_CMD" backend/package.json backend/package-lock.json "${DEST}:${PROD_PATH}/"
$RUN_RSYNC $DRY_RUN -az --delete -e "$SSH_CMD" backend/node_modules/ "${DEST}:${PROD_PATH}/node_modules/"
$RUN_RSYNC $DRY_RUN -az --delete -e "$SSH_CMD" backend/public/ "${DEST}:${PROD_PATH}/public/"

if [[ -n "$DRY_RUN" ]]; then
  echo "=== Simulation terminée — aucune modification envoyée ==="
  exit 0
fi

# Le .env de production vit uniquement sur le serveur, à la racine du site (jamais dans le repo).
if $RUN_SSH -p "${PROD_PORT}" "${DEST}" "test -f ${PROD_PATH}/.env"; then
  echo "✅ .env présent sur le serveur."
else
  cat <<'EOF'

⚠️  .env ABSENT à la racine du site — l'app ne démarrera pas.
    Crée-le : scripts/setup-server-env.sh (ou voir README.md § Déploiement) :
      DB_HOST=<hôte-mariadb>
      DB_PORT=3306
      DB_USER=<utilisateur-db>
      DB_PASSWORD=<mot-de-passe-db>
      DB_NAME=inventory
      JWT_SECRET=<openssl rand -hex 32>
      AUTH_PASSWORD_HASH=<node backend/scripts/hash-password.mjs "<mot de passe>">
      NODE_ENV=production
EOF
fi

cat <<'EOF'

✅ Fichiers envoyés.

⚠️  Dernière étape : redémarre le site dans la console de ton hébergeur.
    Les migrations SQL s'appliquent automatiquement au démarrage.
EOF
