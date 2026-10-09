# SPECS — Backend (Node.js / Express 5)

> **Statut : implémenté.**
> Objectif de ce document : servir de **source de vérité unique** pour le backend — architecture, contrat
> API, protocole de synchronisation et décisions. Le comportement client correspondant est dans
> [`frontend/SPECS.md`](../frontend/SPECS.md).

---

## 1. Contexte

Backend d'une application d'inventaire personnel **offline-first**. Le serveur n'est **pas** la source de
vérité de l'UI : c'est un **journal d'opérations (op-log) partagé**. Chaque appareil travaille localement
(IndexedDB), enregistre ses opérations, et se synchronise en push/pull HTTP. Le serveur :

- stocke les opérations (append-only, dédupliquées par uuid) ;
- authentifie l'utilisateur unique (JWT) ;
- sert le frontend buildé (monolithe) ;
- proxyse la recherche produit par code-barres (Open Food Facts / Open Products Facts) avec cache.

**Il n'interprète pas la sémantique métier** : pas de table `items` côté serveur, pas de calcul d'état.
La convergence est garantie par le repli déterministe des opérations, effectué par chaque client
(cf. `frontend/SPECS.md` § 4).

## 2. Stack & principes

| Élément | Choix | Raison |
|---------|-------|--------|
| Runtime | **Node.js 24 (LTS)** | LTS (support jusqu'en 2028) ; Example le préconise. TypeScript exécuté nativement (type stripping), `tsc --noEmit` pour le typecheck |
| Framework | **Express 5** | minimal, éprouvé, suffisant pour 6 endpoints |
| Base | **MariaDB 10.6.28** | fournie par l'hébergement Example ; dev locale via docker `mariadb:10.6` |
| Driver DB | **mysql2** (pool) | 100 % JS pur |
| Validation | **zod** | validation stricte des payloads d'opérations |
| Auth | **jsonwebtoken + bcryptjs** | 100 % JS purs (pas de bcrypt natif → aucun node-gyp sur l'hébergement) |
| Module | ESM (`"type": "module"`) | imports avec extensions `.ts` explicites (requis par le type stripping) |
| Tests | **node:test** (natif) | zéro dépendance ; intégration DB optionnelle via `TEST_DATABASE_URL` |

**Principe : 100 % des dépendances sont en JS pur** — `node_modules` peut être déployé tel quel par rsync.

## 3. Arborescence

```
backend/
├── package.json            # "type": "module" ; dev = node --watch, prod = node src/server.ts
├── tsconfig.json           # noEmit (typecheck uniquement)
├── .env.example
├── docker-compose.yml      # MariaDB 10.6 locale
├── scripts/hash-password.mjs
├── src/
│   ├── server.ts           # entry : config → pool → migrations → listen(PORT)
│   ├── app.ts              # fabrique Express (routes + middleware + error handler)
│   ├── config.ts           # parsing/validation des variables d'environnement
│   ├── db/
│   │   ├── pool.ts         # pool mysql2 (connectionLimit 5)
│   │   ├── migrate.ts      # runner de migrations (auto au boot + CLI)
│   │   └── migrations/     # *.sql ordonnés, enregistrés dans schema_migrations
│   ├── http/
│   │   ├── auth.ts         # middleware Bearer JWT
│   │   └── routes/
│   │       ├── auth.ts     # POST /api/auth/login
│   │       ├── sync.ts     # head / pull / push
│   │       └── lookup.ts   # GET /api/lookup/:barcode
│   ├── sync/schemas.ts     # schémas zod des opérations
│   ├── lookup/providers.ts # OFF / OPF : fetch + normalisation
│   └── static.ts           # service du frontend buildé + fallback SPA
├── public/                 # build du frontend (gitignoré, produit par `make build`)
└── test/                   # node:test
```

## 4. Configuration (`backend/.env`)

| Variable | Requis | Description |
|----------|--------|-------------|
| `PORT` | non (déf. `3000`) | port d'écoute ; **fourni par Example en prod** (cf. § 9) |
| `DB_HOST` | oui* | hôte MariaDB |
| `DB_PORT` | non (déf. `3306`) | port MariaDB |
| `DB_USER` | oui* | utilisateur DB |
| `DB_PASSWORD` | oui* | mot de passe DB — **brut, sans encodage** (%, @, : autorisés) |
| `DB_NAME` | oui* | nom de la base (`REDACTED`) |
| `DATABASE_URL` | non | alternative legacy `mysql://user:pass@host:3306/db` — décodage tolérant (un % brut ne crashe pas) ; les `DB_*` ont priorité |
| `JWT_SECRET` | oui | secret HS256 (≥ 32 caractères aléatoires) |
| `AUTH_PASSWORD_HASH` | oui | hash bcrypt du mot de passe unique (`$2a$...`) |
| `NODE_ENV` | non (déf. `development`) | `production` active les logs/headers stricts |
| `TEST_DATABASE_URL` | non | si défini, les tests d'intégration s'exécutent contre cette base |

\* ou `DATABASE_URL`. Chargement natif : `node --env-file=.env` (dev) / variables du Manager (prod).
Aucune dépendance dotenv.

## 5. Base de données

Charset `utf8mb4`, collation `utf8mb4_unicode_ci`, moteur InnoDB.

### `ops` — journal d'opérations (append-only)

```sql
CREATE TABLE ops (
  seq        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid       CHAR(36)     NOT NULL,
  device_id  VARCHAR(64)  NOT NULL,
  hlc        VARCHAR(96)  NOT NULL,
  type       VARCHAR(32)  NOT NULL,
  entity_id  CHAR(36)     NOT NULL,
  payload    JSON         NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (seq),
  UNIQUE KEY uq_ops_uuid (uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- `seq` : ordre global d'arrivée serveur (curseur de pull) ;
- `uuid` : identifiant client de l'op — **clé d'idempotence** du push ;
- `hlc` : horodatage hybride client (chaîne triable lexicographiquement, cf. `frontend/SPECS.md` § 4.2) ;
- `payload` : JSON typé selon `type` (cf. § 7).

### `barcode_cache` — cache de lookup

```sql
CREATE TABLE barcode_cache (
  barcode    VARCHAR(64)  NOT NULL,
  found      TINYINT(1)   NOT NULL,
  source     VARCHAR(32)  NOT NULL,
  name       VARCHAR(512) NULL,
  brand      VARCHAR(255) NULL,
  quantity   VARCHAR(64)  NULL,
  image_url  VARCHAR(1024) NULL,
  fetched_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (barcode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Entrées revalidées après `BARCODE_CACHE_TTL` (7 jours). Les résultats négatifs sont cachés aussi
(évitent de marteler les API publiques pour des produits absents).

### `schema_migrations`

```sql
CREATE TABLE schema_migrations (
  version    VARCHAR(64) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Migrations

- Fichiers `src/db/migrations/NNNN_description.sql`, appliqués dans l'ordre lexicographique ;
- **exécutées automatiquement au démarrage du serveur** (idempotent : chaque fichier une seule fois) ;
- `node src/db/migrate.ts` (= `make db-migrate`) pour les appliquer à la main ;
- les `CREATE TABLE` sont `CREATE TABLE IF NOT EXISTS` (résiste aux redémarrages concurrents).

## 6. Modèle de synchronisation

### 6.1 Opération

Une opération = une mutation élémentaire, créée par un client, immuable :

```json
{
  "uuid": "3f9c24e0-8b1a-4c2e-9f3d-7a1b2c3d4e5f",
  "deviceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "hlc": "001728211200000:000003:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "type": "item.adjust",
  "entityId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "payload": { "delta": 1 }
}
```

| `type` | `payload` | Sémantique |
|--------|-----------|------------|
| `item.create` | `{ name: string, barcodes?: string[], barcode?: string, location?: string, category?: string }` | création d'un item (qté initiale 0) ; `barcodes` = liste de codes associés, `barcode` = forme legacy (v1) conservée pour le replay |
| `item.adjust` | `{ delta: number }` (entier) | incrément/décrément de quantité |
| `item.set` | `{ field: "name"\|"barcode"\|"location"\|"category", value: string }` | modification d'un champ (LWW par champ) ; `field: "barcode"` = forme legacy (un seul code) |
| `item.barcodes.set` | `{ barcodes: string[] }` (≤ 20, format `^[0-9A-Za-z_-]{3,64}$`) | remplacement de la liste des codes-barres d'un item (fusion, multi-association) |
| `item.delete` | `{}` | suppression (tombstone) |

### 6.2 Règles serveur (volontairement minimales)

- Validation de **forme** uniquement (schémas zod du § 7) : uuid v4, `deviceId` 1–64, `hlc` format
  `^0{0,14}\d{1,15}:\d{1,6}:[a-z0-9-]{1,64}$` (insensible à la casse, normalisé en minuscules), `type`
  dans la liste, `payload` conforme au type, `entityId` uuid ;
- **Aucune règle métier** (pas de vérification d'existence d'item, pas de calcul d'état) ;
- Insertion **idempotente** : `INSERT ... IGNORE` sur `uuid` — repousser une op déjà connue ne duplique rien ;
- Tout le lot d'un push est inséré dans **une transaction** ; le serveur répond `200` même si le lot est
  entièrement composé de doublons (dans ce cas `accepted: []`).

### 6.3 Ce que le serveur ne fait PAS (décisions)

- **Pas de projection `items`** : l'état courant est reconstruit par chaque client (repli déterministe
  trié par `(hlc, deviceId, uuid)`) — le serveur ne peut donc jamais diverger des clients ;
- **Pas de temps serveur dans les données** : seul `hlc` client détermine l'ordre logique ; `created_at`
  et `seq` ne servent qu'au debug et à la pagination du pull ;
- **Pas de compaction/snapshot en v1** : un nouvel appareil se synchronise en pullant tout le journal
  depuis `cursor=0`. Volume attendu (usage personnel) : quelques dizaines de milliers d'ops ≈ quelques Mo.
  Voir § 12 pour le snapshot.

## 7. Contrat API

Convention : base `/api`, JSON partout, erreurs `{"error": "message"}` (français, destiné à l'affichage).
Auth : en-tête `Authorization: Bearer <token>` sur tout sauf `/auth/login` et `/health`.

### `GET /api/health`

`200` `{"status": "ok"}` — sans auth (sonde).

### `POST /api/auth/login`

Corps : `{"password": "…"}`.

- **200** : `{"token": "<jwt>", "expiresAt": 1767225600000}` (epoch ms) ;
- **400** : corps invalide ;
- **401** : `{"error": "Mot de passe incorrect."}` — délai forcé de 400 ms avant réponse
  (limitation de force brute naïve, en plus d'un plafond de 5 tentatives/minute/IP en mémoire) ;
- **500** : si `AUTH_PASSWORD_HASH` absent/malformé (erreur de configuration).

JWT : HS256, payload `{sub: "owner"}`, expiration **90 jours**. Aucun refresh : à expiration, le client
retourne à l'écran de connexion (l'app reste utilisable hors-ligne, cf. frontend § 5.4).

### `GET /api/sync/head`

- **200** : `{"cursor": 42}` — plus grand `seq` du journal (le client l'utilise pour vérifier qu'il est à jour).

### `GET /api/sync/pull?cursor=&limit=`

- `cursor` : entier ≥ 0 (défaut 0) — dernier `seq` connu du client ;
- `limit` : entier 1–500 (défaut 200) ;
- **200** : `{"ops": [Op…], "cursor": <dernier seq renvoyé>}` — ops **triées par `seq` croissant**,
  `cursor` = `seq` de la dernière op renvoyée (= `cursor` demandé si aucune op) ;
- **400** : paramètres invalides.

Un nouvel appareil boucle pull (`cursor` = `cursor` retourné) jusqu'à obtenir `ops.length < limit`.

### `POST /api/sync/push`

Corps : `{"ops": [Op…]}` — **1 à 500 opérations**.

- **200** : `{"accepted": ["<uuid>"…], "duplicated": ["<uuid>"…]}` — partition des uuid du lot
  (doublon = op déjà présente côté serveur) ;
- **400** : lot vide, > 500, ou **une seule** op invalide (le lot entier est rejeté, message précisant l'index) ;
- **401** : token absent/expiré.

### `GET /api/lookup/:barcode`

`barcode` : `^[0-9A-Za-z_-]{3,64}$` (EAN-8/13, UPC, Code128…).

- **200** :
  ```json
  { "found": true,  "source": "openfoodfacts", "name": "Lessic Pur", "brand": "Dr. Beckmann", "quantity": "750 ml", "imageUrl": "https://…jpg" }
  ```
  ou `{"found": false}` (produit absent des deux sources — mis en cache également) ;
- **400** : code-barres invalide ; **401** ; **502** : les deux sources sont injoignables/en erreur.

Chaîne de recherche : cache DB (TTL 7 j) → **Open Food Facts** (`world.openfoodfacts.org/api/v2/product/:code.json`)
→ **Open Products Facts** (`world.openproductsfacts.org/api/v2/product/:code.json`) → négatif.
Timeout de 6 s par source ; `User-Agent` dédié (`inventory/<version> (usage personnel)` — étiquette des API OFF)
et `Accept-Language: fr, en;q=0.5` (français d'abord, repli anglais — sans quoi les API renvoient l'allemand
depuis la Suisse). Nom normalisé : `product_name` (ou `product_name_fr`, ou `product_name_en`, ou `generic_name`)
+ marque séparée.

## 8. Service du frontend (monolithe)

- `express.static("public")` avec cache long sur `/assets/*` (fichiers hashés par Vite : `Cache-Control: public, max-age=31536000, immutable`) ;
- fallback **SPA** : tout `GET` non `/api/*` et non fichier → `public/index.html` (l'app est mono-vue, le fallback sert surtout `/` et les éventuelles futures routes) ;
- `index.html` jamais mis en cache (`no-cache`) — le service worker gère l'offline ;
- JSON body limit : **256 kB** (les lots d'ops sont petits) ; `/api/sync/push` accepte aussi `text/plain` ? **Non** — `application/json` uniquement ;
- pas de middleware CORS : le frontend est same-origin (en dev, le proxy Vite rend l'origine identique).

## 9. Déploiement Example (site Node.js)

Vérifié d'après les FAQ Example 2537 / 2535 / 2054 :

1. **Manager** → Hébergement → Ajouter → *projet avec technologies avancées* → **Node.js**,
   méthode **personnalisée** (import du code par SSH/rsync), domaine ou sous-domaine dédié ;
2. **Paramètres avancés** (onglet Node.js) :
   - dossier d'exécution : **la racine du site** (`./` — là où rsync dépose `package.json`, `src/`,
     `node_modules/` et `public/`) ;
   - version Node : **24** ;
   - commande de construction : vide (aucun build serveur — le frontend est buildé localement) ;
   - commande de lancement : `npm start` (= `node --env-file-if-exists=.env src/server.ts`, type
     stripping natif Node 24) ;
   - port d'écoute : le port dynamique fourni par le Manager — le code écoute sur `process.env.PORT` ;
   - **variables d'environnement : dans un `.env` à la racine du site** (créé via SSH, cf. README §
     Déploiement, ou `scripts/setup-server-env.sh`) — jamais dans le repo ni dans `.deploy.env` :
     `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` (base `REDACTED` Example), `JWT_SECRET`,
     `AUTH_PASSWORD_HASH`, `NODE_ENV=production`. `PORT` est injecté par le Manager ;
3. **Déploiement** : `scripts/deploy.sh` = rsync de `backend/` (src, package.json, node_modules, public)
   vers `PROD_PATH` + rappel de redémarrer le site dans le Manager. **Mot de passe SSH à chaque fois**
   (clé SSH non supportée pour les sites Node.js, FAQ 2054) ;
4. **MariaDB** : base créée dans le Manager (Example), `DATABASE_URL` pointe vers l'hôte DB Example ;
   les migrations s'appliquent automatiquement au (re)démarrage ;
5. HTTPS : certificat Let's Encrypt via le Manager (obligatoire pour l'installation PWA et `getUserMedia`).

## 10. Sécurité

- Mot de passe unique hashé **bcrypt** (coût 10) ; comparaison en temps constant ; délai + plafond de
  tentatives sur `/auth/login` ;
- JWT HS256, secret ≥ 32 caractères, 90 jours, transport HTTPS uniquement ;
- validation zod stricte de toute entrée (ops, barcode, query params) ; `payload` limité aux champs
  attendus (`value` ≤ 512 chars, `name` ≤ 256, strings trimmées non vides quand requis) ;
- pas de cookie, pas de session serveur : stateless, redémarrage Example sans impact ;
- app privée : `<meta name="robots" content="noindex">` côté frontend + `robots.txt` Disallow.

## 11. Tests (`node:test`)

- **Unitaires** : schémas zod (cas valides/invalides par type d'op), normalisation lookup (payloads OFF/OPF
  mockés), auth (login ok/ko, délai, signature/vérification JWT) ;
- **Intégration** (si `TEST_DATABASE_URL` défini, sinon skip silencieux) : migrations, push idempotent
  (doublon uuid), pull par curseur/limit, head.

## 12. Évolutions envisagées (hors v1)

- **Refonte auth** : changement de mot de passe sans SSH, politique de longueur plus stricte (actuellement
  6 caractères minimum, choix temporaire), refresh token, rate-limit persistant (Redis/DB) ;
- **Snapshot** (`GET /api/sync/snapshot`) : état replié côté serveur pour bootstrap rapide d'un nouvel
  appareil + compaction du journal (les ops antérieures au snapshot deviennent prunables) ;
- export CSV/JSON de l'inventaire (`GET /api/export`) ;
- gestion d'une éventuelle deuxième liste/inventaire (multi-espaces) ;
- rate-limit persistant (Redis/DB) si besoin au-delà du plafond mémoire naïf.
