# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

## NaviPay local MVP

- Run the single-host demo with `npm start`; the server entrypoint and API routes are authoritative in `src/server.js`.
- Run `npm test` for lifecycle and policy coverage, and `npm run check` for syntax validation.
- The default path is deterministic mock mode. Domain invariants and replaceable adapter contracts live in `src/domain.js` and `src/adapters.js`.
