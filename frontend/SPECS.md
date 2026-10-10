# SPECS — Frontend (React 19 / Vite / PWA)

> **Statut : implémenté.**
> Objectif de ce document : servir de **source de vérité unique** pour le frontend — comportement, UX,
> données locales, moteur de synchronisation et thème. Le contrat API est dans
> [`backend/SPECS.md`](../backend/SPECS.md).

---

## 1. Contexte

Frontend d'une application d'inventaire personnel **offline-first** : liste de produits avec quantités
ajustables, recherche/filtre, scan de codes-barres depuis le téléphone. Toutes les lectures et écritures
passe par **IndexedDB** — le réseau n'est jamais requis pour utiliser l'app ; il ne sert qu'à la
synchronisation et au lookup de codes-barres inconnus.

- **Stack** : React 19, Vite, TypeScript, Dexie (IndexedDB), CSS maison (pas de framework CSS) ;
- **UI en français**, thème **sombre unique** ;
- **Natif d'abord** : `<dialog>`, `<datalist>`, validation de formulaires natives, responsive CSS pur,
  `BarcodeDetector`… React ne fait que la logique métier et le rendu ;
- **Navigateurs cibles** : dernières versions de **Chrome** et **Firefox** uniquement (evergreen,
  pas de polyfills).

## 2. Exigences produit (non négociables)

- [x] **UI en français** (libellés, statuts, messages d'erreur) — pas de couche i18n.
- [x] **Thème sombre uniquement** (pas de thème clair, pas de bascule).
- [x] **Offline-first** : CRUD complet sans réseau ; rien n'est jamais bloqué par l'absence de connexion.
- [x] **Aucun incrément perdu** : deux appareils modifiant la même quantité hors-ligne convergent
      (somme des deltas, cf. § 4.4).
- [x] **Modales natives `<dialog>`** (`showModal()`) — y compris sur desktop.
- [x] Boutons +/− **en ligne sur grand écran** (≥ 768 px) ; sur petit écran, un tap sur la ligne ouvre
      la modale quantité.
- [x] **Bouton scan visible sur mobile uniquement** (< 768 px, media query CSS — aucun JS de responsive).
- [x] **Lookup en ligne** des codes-barres inconnus (Open Food Facts → Open Products Facts) avec
      **fallback création locale** systématique.
- [x] Quantités **en pièces uniquement** (pas d'unités), plancher à **0**.
- [x] **Une seule liste** d'inventaire.
- [x] **Utilisateur unique**, multi-appareils (téléphone + desktop).

## 3. Données locales (Dexie / IndexedDB)

Base `inventory` (v3 — v1 : un seul `barcode` scalaire par item, migré vers la liste `barcodes` ;
v3 : table `embeddings` neuve, rien à migrer) :

| Table | Champs / index | Rôle |
|-------|----------------|------|
| `ops` | `uuid` (PK), `deviceId`, `hlc`, `type`, `entityId`, `payload`, `synced` (0/1), `seq` (null si non synchronisée) | journal local **complet** de toutes les opérations (locales + distantes) |
| `items` | `id` (PK), `name`, `barcodes` (index multi-entrées), `location`, `category`, `qty`, `deleted`, `createdAt`, `updatedAt`, `fieldHlc` ({name, barcode, location, category}) | **projection** de l'état courant, reconstruite par le fold (§ 4) ; les tombstones y restent (`deleted: 1`, filtrés par l'UI) |
| `meta` | `key` (PK), `value` | `deviceId`, `cursor` (seq serveur), `hlcWall`, `hlcCounter`, `lastSyncAt`, `suggestActive` |
| `lookups` | `barcode` (PK), `found`, `source`, `name`, `brand`, `quantity`, `imageUrl`, `fetchedAt` | cache local du lookup (§ 7.3) |
| `embeddings` | `itemId` (PK), `nameHash`, `vector` (ArrayBuffer) | cache des vecteurs d'embeddings des noms (§ 9) — recalculés si `nameHash` ≠ nom normalisé courant |

- `deviceId` : UUID généré une fois par navigateur (stocké dans `meta`) ;
- identifiants d'items : UUID v4 générés par le client (`crypto.randomUUID()`) — aucune création ne
  dépend du serveur ;
- l'app ne lit **jamais** le serveur pour afficher des données : `useLiveQuery` sur Dexie uniquement.

## 4. Modèle d'opérations & convergence

### 4.1 Opérations

Mêmes formes que le contrat backend (`item.create`, `item.adjust`, `item.set`, `item.barcodes.set`,
`item.delete`). Chaque mutation de l'UI produit une ou plusieurs ops **immédiatement écrites dans
`ops`** (jamais d'appel réseau dans le chemin d'écriture). Une op locale est `synced: 0`, `seq: null`
jusqu'à son ack.

### 4.2 Horloge hybride (HLC)

- `now()` : `wall = max(Date.now(), lastWall)` ; si `wall == lastWall` alors `counter++` sinon `counter = 0` ;
- `receive(op)` : `lastWall = max(lastWall, op.wall)` ; si `op.wall == lastWall` alors
  `counter = max(counter, op.counter) + 1` (monotonie garantie même en cas de dérive d'horloge) ;
- encodage **chaîne triable** : `wall` paddé sur 15 chiffres, `counter` sur 6, puis `deviceId` →
  l'ordre total est l'ordre lexicographique de la chaîne ;
- comparaison : `(hlc, deviceId, uuid)` — ordre total déterministe identique sur tous les appareils.

### 4.3 Fold (repli déterministe)

`rebuild(ops) : Map<id, Item>` — tri des ops par `(hlc, deviceId, uuid)` puis, dans l'ordre :

| Op | Règle |
|----|-------|
| `item.create` | ignore si l'id existe déjà, ou si un code-barres du payload est déjà porté par un autre item actif (déduplication de création concurrente : premier arrivé gagne) ; sinon crée `{qty: 0, barcodes, …payload}` (`barcode` scalaire = forme legacy, traduite en liste) |
| `item.adjust` | si l'item existe et non supprimé : `qty = max(0, qty + delta)` |
| `item.set` | si l'item existe, non supprimé, et `op.hlc > fieldHlc[field]` : applique (LWW par champ) et enregistre `fieldHlc[field]` ; `field: "barcode"` (legacy) est traduit dans la liste `barcodes` |
| `item.barcodes.set` | si l'item existe, non supprimé, et `op.hlc > fieldHlc.barcode` : remplace la liste (trim + dédup), ignore si un code est déjà porté par un autre item actif |
| `item.delete` | marque `deleted = 1` (les ops suivantes sur cet id sont ignorées) ; la suppression libère les codes-barres de l'item |

**Invariants** : `qty ≥ 0` toujours ; les tombstones survivent ; deux appareils appliquant le même
ensemble d'ops aboutissent au **même état octet pour octet**.

### 4.4 Stratégie d'application (perf de l'UI)

- **Op locale** : application incrémentale immédiate (`applyOp`) → l'UI réagit instantanément ;
- **Sync** : après chaque pull/push, **repli complet** (`rebuild` sur tout le journal) puis réécriture de
  la projection `items` — c'est ce repli complet qui garantit la convergence (les deltas se recombinent
  dans l'ordre canonique, indépendamment de l'ordre d'arrivée locale) ;
- volume attendu (usage personnel) : l'ordre de quelques dizaines de milliers d'ops → rebuild ≈ quelques ms.

## 5. Moteur de synchronisation (`src/sync/`)

### 5.1 Déclencheurs

- événement `online` ; retour de visibilité de l'onglet (`visibilitychange`) ;
- après toute op locale (débounce 800 ms) ;
- timer périodique (60 s) ;
- clic sur le badge de sync (manuel).

Une seule sync à la fois (sémaphore). Les ops sont **jamais** supprimées du journal local.

### 5.2 Algorithme

```
sync():
  si pas de token → état "hors ligne" (attente reconnexion), stop
  état = syncing
  push: tant que des ops non synced existent (lots de 200 via POST /api/sync/push):
        marquer synced=1 pour les uuid "accepted" ET "duplicated" (doublon = déjà enregistré)
  pull: boucle GET /api/sync/pull?cursor=<meta.cursor>&limit=200:
        insérer les ops distantes (synced=1, seq=s), meta.cursor = cursor retourné
        jusqu'à ops.length < limit
  rebuild complet + réécriture de la projection items
  meta.lastSyncAt = now ; état = synced (ou error si échec réseau/serveur)
```

Erreurs réseau : état `offline` (badge), retry au prochain déclencheur — **aucune file perdue**.
`401` : token expiré → état `auth-expired`, écran de connexion affiché, l'inventaire local reste
consultable/éditable en dessous (les ops attendront la reconnexion).

### 5.3 Badge de statut (header)

| État | Affichage |
|------|-----------|
| `syncing` | « Synchronisation… » (animation) |
| `synced` | « Synchronisé HH:MM » |
| `pending` | « N à synchroniser » (N = ops non synced) |
| `offline` | « Hors ligne » |
| `error` | « Échec de synchronisation » |
| `auth-expired` | « Session expirée » |

Clic sur le badge → sync immédiate. Tooltip natif (`title`) détaillant l'état.

### 5.4 Login

- Écran de connexion (mot de passe seul, cf. backend § 7) tant qu'aucun token valide n'est en
  `localStorage` (`inventory.token`, TTL 90 j affiché) ;
- la validation est native (`required`) ; erreur 401 → « Mot de passe incorrect. » (message serveur) ;
- une fois connecté, l'app ne redemande jamais le mot de passe tant que le token est valide,
  **même hors-ligne**.

## 6. Comportement UI

### 6.1 Structure

```
<header>  titre + badge de sync + recherche + bouton « Ajouter » (≥ 768 px)
<main>    <ul> liste d'items (max-width 640 px centrée) ou état vide
<dialog>  quantité · création/édition · confirmation · scanner
FABs      scan (mobile uniquement) + ajout (mobile)
```

Responsive **CSS pur** (media queries) : aucun JS ne lit la taille d'écran.

### 6.2 Liste

- Tri alphabétique **insensible à la casse et aux accents** (même convention que `listen`) ;
- ligne : **nom** (fort), méta (emplacement · catégorie, discret), **quantité** ;
- **≥ 768 px** : boutons − / + en bout de ligne (− désactivé à 0) ; un clic sur le nom ouvre la modale
  d'édition ;
- **< 768 px** : pas de boutons en ligne — un tap sur la ligne ouvre la **modale quantité** ;
  accès à l'édition via un bouton discret (crayon) en fin de ligne ;
- **recherche** (`<input type="search">`) : filtre en direct sur nom, emplacement, catégorie et
  code-barres — insensible à la casse/accents, **tous les mots** du terme doivent matcher ;
- **filtre manquants** : chip « Manquants » (visible si au moins un produit est à 0, à gauche de
  « Fusionner ») — n'affiche que les produits en rupture ; se combine avec les autres filtres ;
- **action doublons** : chip « Doublons · N » (§ 9.5) à droite de « Fusionner », visible si le
  moteur de suggestions est activé et qu'il y a au moins 2 produits ;
- **filtre emplacement** et **filtre catégorie** : chips horizontales défilables (« Tous » + valeurs
  existantes, déduites des données) ; les deux filtres se combinent (ET) avec la recherche ;
- **état vide** : « Aucun produit. Ajoute ton premier produit ou scanne un code-barres. »
- état vide filtré : « Aucun résultat pour _X_. »
- les items supprimés n'apparaissent jamais.

### 6.3 Mode fusion

Pour regrouper des produits pseudo-dupliqués (variantes de parfum, ressaisies) :

- **Activation** : chip « Fusionner » (visible dès 2 produits) — toggle comme les filtres ;
- en mode fusion, les lignes affichent une **case à cocher** à la place des contrôles quantité/édition ;
  le tap sur la ligne sélectionne aussi ; les FABs (scan/ajout) sont remplacés par une **barre
  d'action** fixe en bas (« Annuler » + « Fusionner (N) », actif dès N ≥ 2) ;
- la sélection **persiste à travers les filtres et la recherche** (on peut fusionner des produits de
  deux emplacements) ; un item supprimé entre-temps est retiré de la sélection ;
- **modale de fusion** (`<dialog>`) : nom du produit conservé (par défaut : celui du **premier de la
  liste**, ordre alphabétique), emplacement, catégorie, **quantité** (par défaut : **somme** des
  produits fusionnés) — tout éditable (validation native) ; codes-barres **cumulés** affichés en
  lecture seule ;
- **écritures** (ordre) : `item.delete` des produits absorbés (libère leurs codes-barres) →
  `item.barcodes.set` (union des codes, ssi différente) → `item.set` par champ édité → `item.adjust`
  du delta de quantité (ssi ≠ 0).

### 6.4 Modale quantité (`<dialog>`)

- Contenu : nom de l'item, gros bouton −, quantité (grand chiffre), gros bouton + ;
- **maintien appuyé = répétition** (`pointerdown`/`pointerup`, ~120 ms) ;
- le − est désactivé à 0 (plancher local, le fold replanifie de toute façon) ;
- pied : « Valider » (commit **un seul** `item.adjust` du delta total) et « Annuler » (aucun changement) ;
- ouverture : `showModal()`, focus sur le bouton + ; fermeture : `Esc` (natif) ou clic sur le backdrop
  (= annuler) ;
- validée avec delta ≠ 0 uniquement (delta 0 = simple fermeture).

### 6.5 Création / édition d'item (`<dialog>`)

- Champs : **nom** (requis, validation native, autofocus, max 256) ; **emplacement** et **catégorie**
  (`<input list>` + `<datalist>` alimentés par les valeurs existantes — suggestion native, saisie libre,
  max 64) ; **code-barres** affiché (lecture seule ; renseigné par le scan, liste complète en édition) ;
- création : une op `item.create` (+ éventuelles `item.set` si emplacement/catégorie) ; si le
  moteur de suggestions est activé, **suggestions d'articles similaires** affichées sous le champ
  nom (§ 9.4) ;
- édition : une op `item.set` **par champ modifié** (LWW par champ) ;
- suppression : bouton → modale de confirmation native → `item.delete` ;
- « Enregistrer » ferme la modale ; en création après un scan, la modale quantité s'ouvre ensuite (§ 7.2).

### 6.6 FABs

- **Scan** (icône code-barres) : `display: none` ≥ 768 px ;
- **Ajout** (icône +) : visible uniquement sur mobile (desktop = bouton du header) ;
- empilés en bas à droite, au-dessus des safe-areas (PWA).

### 6.7 Paramètres

- Bouton engrenage dans le header (toujours visible) → modale de paramètres (`<dialog>`) ;
- contenu : état du moteur de suggestions (§ 9.1) — « Désactivé » + « Activer », progression du
  téléchargement, « Activé — hors ligne » + « Désactiver (supprimer le modèle) », message d'erreur
  + « Réessayer » en cas d'échec.

## 7. Scanner de codes-barres

### 7.1 Détection

- **API native `BarcodeDetector`** (Chrome) en priorité : détection sur frame vidéo toutes les ~150 ms,
  formats `{ean_13, ean_8, upc_a, upc_e, code_128, code_39, itf}`;
- **Firefox ne supporte pas `BarcodeDetector`** → fallback **@zxing/library** (lazy-loaded :
  `import()` dynamique, chunk séparé — jamais chargé sur Chrome) ;
- caméra : `getUserMedia({video: {facingMode: "environment"}})` ; nettoyage des tracks à la fermeture ;
- torche : bouton si `track.getCapabilities().torch` (Chrome Android), via `applyConstraints` ;
- feedback de scan : `navigator.vibrate(40)` + bip court (WebAudio, généré, aucun asset).

### 7.2 Flux de scan

1. Tap sur le FAB scan → modale scanner plein écran (caméra live, cadre de visée) ;
2. détection d'un code → vibration + bip, la caméra **reste active** (mode continu) ;
3. **code connu** → la modale quantité de l'item s'ouvre au-dessus (adjuster +/−, « Valider ») →
   retour caméra ;
4. **code inconnu** → lookup en ligne (§ 7.3) → modale de création **pré-remplie** (nom du produit si
   trouvé, code-barres figé) avec **suggestions d'articles similaires** (§ 9.4) — « Ajouter à cet
   article » fusionne à la volée, sinon « Enregistrer » → modale quantité (qté 0 → +1 direct) →
   retour caméra ;
5. « Terminer » (ou Esc) ferme le scanner ;
6. dernière étiquette scannée affichée en bas de la modale (« Scanné : 3760… »).

### 7.3 Lookup

- Réseau : `GET /api/lookup/:barcode` (même requête que le backend proxyse) ;
- **cache local Dexie** (`lookups`) : réseau d'abord quand en ligne, cache systématiquement écrit ;
  hors-ligne → cache immédiat si présent, sinon `found: false` (création locale sans attendre) ;
- timeout applicatif ~8 s (les deux sources derrière) ; échec réseau → fallback création locale,
  jamais de blocage.

## 8. PWA & offline

- **Manifest** (`manifest.webmanifest`) : `name: "Inventaire"`, `display: standalone`, `theme_color` /
  `background_color` sombres, icônes SVG (dont maskable) ;
- **service worker maison** (`public/sw.js`, ~80 lignes, zéro dépendance) :
  - navigations (`index.html`) : **network-first** avec repli cache (mise à jour de l'app visible au
    prochain lancement) ;
  - `/assets/*` (fichiers hashés Vite) et icônes : **cache-first** (immutables) ;
  - `/api/*` **jamais intercepté** (la sync a sa propre logique de retry) ;
  - activation : `skipWaiting()` + `clients.claim()` ;
- enregistrement du SW en production uniquement (`import.meta.env.PROD`) ;
- `<meta name="theme-color">`, safe-area insets (`env(safe-area-inset-*)`) pour l'affichage standalone ;
- iOS : `apple-touch-icon` (SVG accepté), affichage standalone supporté nativement ;
- robots : `<meta name="robots" content="noindex">` + `robots.txt` Disallow (app privée).

## 9. Suggestions intelligentes (embeddings en navigateur)

Détection de produits pseudo-dupliqués (variantes de parfum, ressaisies) et suggestions à la
création — le modèle tourne **dans le navigateur**, le backend est inchangé.

### 9.1 Moteur

- Modèle **Xenova/multilingual-e5-small** (int8 ≈ 118 Mo) exécuté dans le navigateur via
  `@huggingface/transformers` (WASM) — dynamic import, chunk lazy **jamais chargé au boot** ;
- poids **self-hostés** dans `public/models/e5-small/` (ignorés par git, téléchargés via
  `npm run fetch-model`) ; binaires wasm d'ONNX Runtime packagés par Vite depuis node_modules ;
  **aucun CDN au runtime** — tout est en cache SW (`/models/*` + `/assets/*` cache-first) →
  100 % offline après activation ;
- **activation explicite** (Paramètres, § 6.7) : « Désactivé » par défaut → téléchargement avec
  progression → « Activé — hors ligne » ; « Désactiver » purge les entrées de Cache Storage
  correspondantes (`/models/*` + binaires `ort-wasm*`) ; l'état persiste en `meta`
  (`suggestActive`) ;
- `embed(text, kind)` : préfixes e5 (`query:` = saisie en cours, `passage:` = noms de la base),
  mean pooling + normalisation, appels sérialisés (une session wasm).

### 9.2 Cache des vecteurs (§ 3, table `embeddings`)

- **pass incrémental** (`ensureEmbeddings`) : au démarrage (si activé) et **après chaque sync** ;
  vectorise les noms sans vecteur à jour (invalidation par hash = nom normalisé), purge les
  vecteurs d'items supprimés ; ~30–80 ms/nom en WASM, en tâche de fond.

### 9.3 Scores (calibrés sur données réelles)

- **recentrage** (anti-fond-de-domaine) : sur des noms courts, un fond sémantique commun gonfle
  tous les cosinus (plancher ~0.82 mesuré sur la vraie base) — les vecteurs sont recentrés avant
  toute comparaison (soustraction du centroïde du corpus + renormalisation ; la requête de
  création est recentrée avec le même centroïde) → plancher ~0 ;
- **sémantique** : cosinus sur vecteurs recentrés ; **lexical** : Dice sur bigrammes du nom
  normalisé ; score final = **max des deux**, sous **veto de préfixe** : si le début du libellé
  (16 premiers caractères normalisés) est trop différent (Dice < 0.5), le score est plafonné —
  deux articles du même produit partagent le début de leur nom, alors qu'un long libellé commun
  avec un début différent signale des produits distincts (« Pâtes Coquillette **au blé complet
  sachet de 500g** » ~ « Pâtes Farfalle… » vs « Liquide vaisselle **citron/lavande** ») ;
- seuils (cf. `backend/scripts/calibrate-similarity.mjs`) : doublons **0.70**, suggestions à la
  création **0.65** (top 3) — vrais doublons ≥ ~0.74, bruit ≤ ~0.64 ; le veto élimine aussi les
  produits partageant un mot-clé avec un début différent (« gel » / « sel » régénérant).

### 9.4 Suggestions à la création

- Modale de création, sous le champ nom (saisie manuelle **ou** remplie par le lookup scan) :
  top-3 des articles existants similaires, débouncées de 400 ms (nom ≥ 3 caractères) ;
- suggestion : nom, emplacement · catégorie · quantité, score ; tap → détail (codes-barres
  inclus) → « **Ajouter à cet article** » : op `item.barcodes.set` (l'existant absorbe le code
  scanné, ssi nouveau) puis **modale quantité sur l'existant** — ISO avec le flux scan → produit
  trouvé ; « Enregistrer » reste disponible (création normale).

### 9.5 Doublons dans l'interface

- Chip « **Doublons · N** » à côté de « Fusionner » (visible si moteur activé et ≥ 2 articles) — N =
  nombre de groupes détectés ;
- **groupes** = composantes connexes du graphe de similarité (une arête = paire au-dessus du
  seuil) : 3 articles ou plus mutuellement proches forment **un seul groupe**, fusionnable d'un
  coup (le survivant est le premier de la liste) ; le score affiché est le meilleur lien interne ;
- groupes **calculés en mémoire** (données dérivées — jamais stockées en DB), recalculés
  réactivement à chaque changement (ajout, renommage, fusion, suppression) — le cas « doublon
  raté à la création » est donc couvert automatiquement ;
- modale « Doublons potentiels » : groupes triés par score (un bloc par article : nom, emplacement,
  catégorie, stock) ; tap « Fusionner » → modale de fusion (§ 6.3) préremplie avec le groupe —
  **aucune modification sans action explicite** (un faux positif n'a aucun effet de bord).

## 10. Thème sombre (tokens oklch)

```css
:root {
  --bg:          oklch(0.16 0.012 260);   /* fond app */
  --surface:     oklch(0.21 0.014 260);   /* cartes, lignes */
  --surface-2:   oklch(0.26 0.016 260);   /* hover, inputs */
  --border:      oklch(0.32 0.016 260);
  --text:        oklch(0.93 0.005 260);
  --text-muted:  oklch(0.65 0.012 260);
  --accent:      oklch(0.78 0.15 165);    /* vert menthe — actions, quantité */
  --accent-ink:  oklch(0.22 0.05 165);    /* texte sur accent */
  --danger:      oklch(0.68 0.19 25);
  --radius: 0.75rem;  --radius-sm: 0.5rem;
}
```

- Typographie : pile système (`system-ui`), taille de base 16 px, ligne de nom en 1.05 rem/600 ;
- focus visible (`:focus-visible`, anneau accent) sur **tout** élément interactif ;
- `prefers-reduced-motion: reduce` → transitions/animations désactivées ;
- contrastes AA minimum (texte/fond, disabled à éviter — utiliser `aria-disabled` + désactivation réelle) ;
- scrollbars stylées discrètes ; pas d'animation d'apparition superflue.

## 11. Tests (Vitest + Testing Library)

- **fold** (cœur critique) : convergence — même état après permutation aléatoire des ops ; LWW par champ ;
  plancher 0 ; unicité multi-code-barres ; tombstones ;
- **HLC** : monotonie locale, réception d'op distante, encodage triable ;
- **recherche** : accents/casse, multi-mots, code-barres ;
- **scores** : cosinus, Dice, hybride, classement des suggestions et des paires de doublons ;
- **composants** : `ItemRow` (rendu + callbacks +/− + sélection fusion), `QuantityDialog` (delta,
  validation, plancher), `ItemFormDialog` (suggestions debouncées, fusion à la volée) ;
- migration Dexie `migrateItemV1ToV2` (fonction pure) ;
- moteur de sync : testé via le fold + mocks fetch (push/pull/idempotence) — léger, le backend teste le contrat.

## 12. Glossaire

| Terme | Définition |
|-------|-----------|
| **Op** | opération élémentaire immuable (`create`/`adjust`/`set`/`delete`), unité de synchronisation |
| **HLC** | horloge hybride (temps murale + compteur + deviceId) — ordre total déterministe |
| **Fold** | repli déterministe des ops → état courant (projection `items`) |
| **Outbox** | ops locales non encore synchronisées (`synced: 0`) |
| **Lookup** | recherche produit par code-barres (OFF/OPF) |
| **Tombstone** | marqueur de suppression gardé pour la convergence |
