# inventory

Gestion d'inventaire personnel : une liste de produits avec quantités ajustables (+/−), recherche/filtre
et **scan de codes-barres** depuis le téléphone. Application **offline-first** : tout fonctionne sans réseau
et se resynchronise dès la connexion retrouvée.

## Description

Application web full-stack composée d'un backend **Node.js 24 (Express 5)** et d'un frontend
**React 19 + Vite + TypeScript (PWA)**. En production, le build du frontend est copié dans `backend/public`
(monolithe servi par Express). Les données vivent dans une base **MariaDB 10.6** sous forme de
journal d'opérations ; chaque appareil garde une copie locale (IndexedDB) et converge vers le même état
grâce à un repli déterministe. Interface entièrement en français, thème sombre unique.

> ⚠️ Projet personnel — usage privé, pas de contribution externe.

## Fonctionnalités

- **Liste d'inventaire** : nom, quantité, emplacement, catégorie, code-barres.
- **Quantités faciles** : boutons +/− en ligne sur grand écran ; sur mobile, un tap sur la ligne ouvre une
  modale native `<dialog>` avec des gros boutons +/−.
- **Scan de codes-barres** (bouton visible sur mobile uniquement) : produit connu → modale +/− directement ;
  produit inconnu → recherche Open Food Facts / Open Products Facts, sinon création locale.
- **Recherche/filtre** : insensible à la casse et aux accents, filtre par emplacement.
- **Sync multi-appareils** (téléphone + desktop, utilisateur unique) : hors-ligne total, reprise
  automatique, aucun incrément perdu (log d'opérations + horloge hybride).
- **PWA installable** : fonctionne déconnecté, écran de démarrage, badge de synchronisation.

## Prérequis

- Node.js 24 (via nvm) + npm
- Docker (MariaDB 10.6 locale via docker compose)

## Installation

```bash
git clone git@github.com:ilgazil/inventory.git
cd inventory
make install        # npm install (backend + frontend)
make db-up          # MariaDB 10.6 locale (docker compose)
cp backend/.env.example backend/.env   # puis renseigner les variables (voir Configuration)
node backend/scripts/hash-password.mjs "<ton mot de passe>"   # génère le hash pour AUTH_PASSWORD_HASH
```

En dev, lancer deux terminaux :

```bash
make backend        # API Express   → http://localhost:3000
make frontend       # Vite          → http://localhost:5173 (proxy /api → localhost:3000)
```

Les migrations sont appliquées automatiquement au démarrage du backend (et manuellement via `make db-migrate`).

## Jeu de test réel (import depuis la prod)

Pour développer avec les vraies données du serveur distant (le journal d'opérations seulement —
l'état est reconstruit localement par le fold) :

```bash
node frontend/scripts/export-remote-ops.mjs https://<ton-serveur>   # mot de passe demandé
# → frontend/public/remote-ops.json (ignoré par git)
```

Puis dans l'app locale (console du navigateur) :

```js
await __inventory.importOps(await (await fetch("/remote-ops.json")).json());
```

L'outil d'import n'existe qu'en dev (`import.meta.env.DEV`) ; un mot de passe déjà connu peut
aussi être passé au script via `REMOTE_TOKEN=<jwt>` (sans interaction).

## Commandes

Toutes les commandes passent par le `Makefile` (`make help` liste tout) :

| Cible | Rôle |
|-------|------|
| `make install` | installe les dépendances (backend + frontend) |
| `make backend` / `make frontend` | serveurs de dev (Express :3000 / Vite :5173) |
| `make db-up` / `make db-down` | base locale (docker, démarrer / arrêter) |
| `make db-migrate` | applique les migrations SQL |
| `make test` / `make test-backend` / `make test-frontend` | tests (node:test / Vitest) |
| `make lint` / `make format` | lint (eslint) et format (prettier) |
| `make build` | build du frontend dans `backend/public` |
| `make check` | lint + tests + build (pré-déploiement) |
| `make deploy-dry` / `make deploy` | déploiement (simulation / réel) |

## Configuration

**Jamais de valeurs en dur ni de secrets committés** — tout passe par des fichiers locaux gitignorés.

### Backend — `backend/.env` (à partir de `backend/.env.example`)

| Variable | Description |
|----------|-------------|
| `PORT` | port d'écoute (3000 en dev ; fourni par l'hébergeur en prod) |
| `DB_HOST` / `DB_PORT` | hôte et port MariaDB (déf. `3306`) — en prod : ton hôte MariaDB |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | identifiants DB — **bruts, sans encodage** (%, @, : autorisés dans le mot de passe) ; en dev : `inventory`/`inventory`/`inventory` (docker-compose) |
| `DATABASE_URL` | (alternative legacy) `mysql://user:pass@host:3306/inventory` — les `DB_*` ont priorité |
| `JWT_SECRET` | secret de signature des tokens de session (≥ 32 caractères aléatoires) |
| `AUTH_PASSWORD_HASH` | hash bcrypt du mot de passe unique (généré par `backend/scripts/hash-password.mjs`) |
| `NODE_ENV` | `development` / `production` |

### Frontend

Aucune variable : l'app appelle l'API en relatif (`/api/...`) — proxifiée par Vite en dev, same-origin en prod.

### Déploiement — `.deploy.env` (à partir de `.deploy.env.example`)

| Variable | Description |
|----------|-------------|
| `PROD_HOST` / `PROD_SSH_USER` / `PROD_PORT` | accès SSH au serveur |
| `PROD_PATH` | dossier du site Node.js côté serveur |
| `PROD_URL` | (optionnel) URL publique, affichée dans le récapitulatif de déploiement |

> ⚠️ Certains hébergeurs de sites Node.js **ne supportent pas la connexion par clé SSH** :
> le mot de passe SSH est alors nécessaire à chaque déploiement. Pour ne pas le retaper (ni le
> stocker en clair), enregistre-le une fois dans le trousseau macOS :

```bash
security add-generic-password -s inventory-deploy -a "<PROD_SSH_USER>" -w
```

(Alternative : `PROD_SSH_PASSWORD=…` dans `.deploy.env`, en clair.)

## API (contrat)

| Endpoint | Rôle |
|----------|------|
| `POST /api/auth/login` | connexion (mot de passe) → token JWT |
| `GET /api/sync/head` | position de fin du journal (n° de séquence) |
| `GET /api/sync/pull?cursor=&limit=` | lecture incrémentale des opérations |
| `POST /api/sync/push` | envoi d'un lot d'opérations locales (idempotent) |
| `GET /api/lookup/:barcode` | recherche produit par code-barres (Open Food Facts / Open Products Facts, cache) |
| `GET /api/health` | sonde de santé |

Le contrat détaillé (formes JSON, statuts HTTP) est dans [`backend/SPECS.md`](backend/SPECS.md).

## Tests

```bash
make test            # backend (node:test, DB d'intégration optionnelle) + frontend (Vitest)
make lint            # eslint (backend + frontend)
make check           # lint + tests + build
```

## Déploiement

1. Créer un **site Node.js** (Node 24) chez ton hébergeur avec une base MariaDB — voir
   `backend/SPECS.md` § Déploiement pour les commandes build/start et le port.
2. Créer le **`.env` de production sur le serveur** (une seule fois) — il ne vit jamais dans le repo.
   Le plus simple : `scripts/setup-server-env.sh` (demande hôte/utilisateur/mot de passe DB + mot de
   passe de l'app, génère les secrets et écrit le fichier à la racine du site). À la main :

   ```bash
   openssl rand -hex 32                                    # → JWT_SECRET
   node backend/scripts/hash-password.mjs "<mot de passe choisi>"  # → AUTH_PASSWORD_HASH
   ```

   ```bash
   ssh <user>@<hôte> "cat > <chemin-du-site>/.env" <<'EOF'
DB_HOST=<hôte-mariadb>
DB_PORT=3306
DB_USER=<utilisateur-db>
DB_PASSWORD=<mot-de-passe-db>
DB_NAME=inventory
JWT_SECRET=<sortie de openssl rand -hex 32>
AUTH_PASSWORD_HASH=<sortie de hash-password.mjs>
NODE_ENV=production
EOF
   ```

3. `cp .deploy.env.example .deploy.env` puis renseigner les accès.
4. `make deploy-dry` pour simuler, `make deploy` pour déployer (rsync + redémarrage de l'app).
   Le déploiement exige un **arbre git propre**. Les migrations s'appliquent automatiquement au
   démarrage du backend.

## Documentation

- [`backend/SPECS.md`](backend/SPECS.md) — contrat API, protocole de sync & décisions
- [`frontend/SPECS.md`](frontend/SPECS.md) — comportement, UX, données locales & moteur de sync

## Licence

Projet privé — tous droits réservés.
