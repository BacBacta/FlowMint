# FlowMint Makefile
# Common commands for development, building, and deployment

.PHONY: help install dev build test deploy-devnet docker-build docker-up docker-down clean

# Default target
help:
	@echo "FlowMint - Available Commands"
	@echo "=============================="
	@echo ""
	@echo "Development:"
	@echo "  make install       - Install all dependencies"
	@echo "  make dev           - Start development servers"
	@echo "  make test          - Run all tests"
	@echo "  make lint          - Run linters"
	@echo ""
	@echo "Building:"
	@echo "  make build         - Build all packages"
	@echo "  make build-program - Build Anchor program"
	@echo ""
	@echo "Deployment:"
	@echo "  make deploy-devnet - Deploy smart contract to devnet"
	@echo "  make deploy-mainnet- Deploy smart contract to mainnet"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-build  - Build Docker images"
	@echo "  make docker-up     - Start Docker containers"
	@echo "  make docker-down   - Stop Docker containers"
	@echo "  make docker-logs   - View container logs"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean         - Clean build artifacts"

# ==============================================
# Development
# ==============================================

install:
	@echo "Installing dependencies..."
	cd server && npm install
	cd app && npm install
	cd program && npm install
	@echo "Done!"

dev:
	@echo "Starting development servers..."
	@echo "Server: http://localhost:3001"
	@echo "App: http://localhost:3000"
	@echo "Docs: http://localhost:3001/docs"
	cd server && npm run dev &
	cd app && npm run dev &
	wait

dev-server:
	cd server && npm run dev

dev-app:
	cd app && npm run dev

test:
	@echo "Running tests..."
	cd server && npm test
	cd program && anchor test

test-server:
	cd server && npm test

test-program:
	cd program && anchor test

lint:
	cd server && npm run lint
	cd app && npm run lint

# ==============================================
# Building
# ==============================================

build: build-server build-app build-program

build-server:
	@echo "Building server..."
	cd server && npm run build

build-app:
	@echo "Building app..."
	cd app && npm run build

build-program:
	@echo "Building Anchor program..."
	cd program && anchor build

# ==============================================
# Deployment
# ==============================================

deploy-devnet:
	@echo "Deploying to Solana devnet..."
	./scripts/deploy-devnet.sh

deploy-mainnet:
	@echo "⚠️  WARNING: Deploying to mainnet!"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ]
	@echo "Deploying to Solana mainnet..."
	cd program && anchor deploy --provider.cluster mainnet

# ==============================================
# Docker
# ==============================================

docker-build:
	@echo "Building Docker images..."
	docker-compose build

docker-up:
	@echo "Starting Docker containers..."
	docker-compose up -d
	@echo ""
	@echo "Services running:"
	@echo "  - Server: http://localhost:3001"
	@echo "  - App: http://localhost:3000"
	@echo "  - Docs: http://localhost:3001/docs"
	@echo "  - Redis: localhost:6379"

docker-up-prod:
	@echo "Starting production Docker containers..."
	docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

docker-down:
	@echo "Stopping Docker containers..."
	docker-compose down

docker-logs:
	docker-compose logs -f

docker-logs-server:
	docker-compose logs -f server

docker-logs-app:
	docker-compose logs -f app

docker-clean:
	@echo "Cleaning Docker resources..."
	docker-compose down -v --rmi local

# ==============================================
# Database
# ==============================================

db-migrate:
	@echo "Running database migrations..."
	cd server && npm run db:migrate

db-reset:
	@echo "Resetting database..."
	rm -f server/data/flowmint.db
	cd server && npm run db:migrate

# ==============================================
# Cleanup
# ==============================================

clean:
	@echo "Cleaning build artifacts..."
	rm -rf server/dist
	rm -rf app/.next
	rm -rf app/out
	rm -rf program/target
	rm -rf node_modules/.cache
	@echo "Done!"

clean-all: clean
	@echo "Cleaning all dependencies..."
	rm -rf server/node_modules
	rm -rf app/node_modules
	rm -rf program/node_modules
	@echo "Done!"

# ==============================================
# Utility
# ==============================================

logs:
	tail -f server/logs/*.log

airdrop:
	@echo "Requesting SOL airdrop on devnet..."
	solana airdrop 2 --url devnet

check-balance:
	solana balance --url devnet
