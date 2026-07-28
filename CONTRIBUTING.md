# Contributing

1. Create a branch from `main`.
2. Keep credentials, user sessions, `.env.local`, and packaged binaries out of
   the branch.
3. Run `npm run verify:public-source`, `npm run typecheck`, and `npm test`.
4. Describe the user-facing change and verification in the pull request.

Changes that add a provider or external tool must document where credentials
are stored and must never move a secret into renderer/browser code.
