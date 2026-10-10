.DEFAULT_GOAL := help
.PHONY: help install backend frontend db-up db-down db-migrate test test-backend test-frontend lint lint-backend lint-frontend format build check deploy deploy-dry sync-prod

# Utilise Node 24 via nvm (le Node système peut être plus ancien).
# Si nvm est absent, la commande tourne avec le Node système en place.
NVM := export NVM_DIR="$$HOME/.nvm"; . "$$NVM_DIR/nvm.sh" 2>/dev/null; nvm use 24 >/dev/null 2>&1 || true

help: ## Affiche cette aide et liste les commandes
	@rg '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*##/  /'

install: ## Installe les dépendances (backend + frontend)
	@$(NVM); cd backend && npm install
	@$(NVM); cd frontend && npm install

backend: ## Lance le backend Express (http://localhost:3000)
	@$(NVM); cd backend && npm run dev

frontend: ## Lance le frontend Vite (http://localhost:5173)
	@$(NVM); cd frontend && npm run dev

db-up: ## Démarre MariaDB 10.6 locale (docker-compose, port hôte 33060)
	cd backend && docker-compose up -d

db-down: ## Arrête MariaDB locale
	cd backend && docker-compose down

db-migrate: ## Applique les migrations SQL
	@$(NVM); cd backend && npm run migrate

test: test-backend test-frontend ## Lance tous les tests (backend + frontend)

test-backend: ## Lance les tests backend (node:test ; intégration si TEST_DATABASE_URL défini)
	@$(NVM); cd backend && npm test

test-frontend: ## Lance les tests frontend (Vitest)
	@$(NVM); cd frontend && npm test

lint: lint-backend lint-frontend ## Lint + typecheck (backend et frontend)

lint-backend: ## Typecheck du backend (tsc --noEmit)
	@$(NVM); cd backend && npm run typecheck

lint-frontend: ## ESLint du frontend
	@$(NVM); cd frontend && npm run lint

format: ## Formate le frontend (prettier)
	@$(NVM); cd frontend && npm run format

build: ## Build le frontend (typecheck + vite build → backend/public)
	@$(NVM); cd frontend && npm run build

check: lint test build ## Vérifications complètes avant déploiement

deploy: check ## Vérifie puis déploie sur la prod (rsync + mot de passe SSH), voir .deploy.env
	scripts/deploy.sh

deploy-dry: ## Simule le déploiement (dry-run rsync, rien n'est envoyé)
	scripts/deploy.sh --dry-run

sync-prod: ## Importe le journal d'ops de la prod dans le backend local (jeu de test réel)
	@$(NVM); url=$$(grep '^PROD_URL=' .deploy.env 2>/dev/null | cut -d= -f2-); \
	if [ -z "$$url" ]; then echo "PROD_URL absent de .deploy.env"; exit 1; fi; \
	node scripts/sync-prod.mjs "$$url"
