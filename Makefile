format:
	pnpx prettier --write ./src

lint:
	pnpm run lint

check: format lint

dev: 
	pnpm tauri dev