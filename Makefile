.DEFAULT_GOAL := help
SHELL := /bin/bash

ifneq (,$(wildcard .env))
include .env
export
endif

NPM ?= npm
IMAGE ?= trading-frontend:local

.PHONY: help env install run test lint build preview check docker clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'

env: ## Create .env from .env.example when missing
	@test -f .env || cp .env.example .env

install: ## Install dependencies from the lockfile
	$(NPM) ci

run: env install ## Start the Vite dev server on port 5173
	$(NPM) run dev

test: ## No test suite configured
	@echo "trading-frontend has no test suite configured"

lint: ## No linter configured
	@echo "trading-frontend has no linter configured"

build: install ## Build the static bundle
	$(NPM) run build

preview: build ## Preview the production build on port 4173
	$(NPM) run preview

check: build ## Build the static bundle

docker: ## Build the container image
	docker build -t $(IMAGE) .

clean: ## Remove build output and dependencies
	rm -rf dist node_modules
