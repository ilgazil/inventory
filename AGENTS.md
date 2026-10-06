# AGENTS.md — inventory

## Règles globales

- **Ne jamais `git commit`** (ni `add`, ni `push`, ni PR). C'est l'utilisateur qui commit — en faire la demande si nécessaire.
- Modifier le code, la config et la doc (`AGENTS.md`, `SPECS.md`) sans versionner.

## Langues

- **Interface de l'app : français** (labels, statuts, messages UI). Jamais de traduction/i18n — le français est la langue unique.
- **Code : anglais** (identifiants, noms de fichiers, chaînes du contrat API).
- **Commentaires : français.**
- **Docs (`README`, `SPECS.md`, `AGENTS.md`, scripts/deploy.sh, Makefile…) : français.**

## Principes techniques (non négociables)

- **Natif d'abord** : tout ce qui peut être fait en HTML/CSS doit l'être (responsive, `<dialog>`, validation
  de formulaires natives, `<datalist>`, …). JavaScript (React) uniquement pour la logique métier.
- **Navigateurs cibles** : dernières versions de Chrome et Firefox uniquement (evergreen). Pas de polyfills,
  pas de support des vieilles versions. Les API natives modernes (`BarcodeDetector`, `:has()`, …) sont
  utilisées avec une solution de repli uniquement quand Firefox ne les supporte pas.
- **Dépendances minimales** : chaque nouvelle dépendance doit se justifier (100 % JS purs côté backend,
  pas de lib UI ni de framework CSS côté frontend).
