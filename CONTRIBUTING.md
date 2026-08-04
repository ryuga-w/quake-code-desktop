# Contributing to Quake Code Desktop

Thank you for helping improve Quake Code. Focused bug fixes, tests, documentation, accessibility improvements, and clearly scoped feature proposals are welcome.

## Before you start

- Search existing [issues](https://github.com/ryuga-w/quake-code-desktop/issues) and [discussions](https://github.com/ryuga-w/quake-code-desktop/discussions).
- Open an issue before a large architectural change so the approach can be aligned early.
- Report vulnerabilities privately by following [SECURITY.md](SECURITY.md).
- Read and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Local setup

Quake Code currently targets Windows 10/11 x64. Development requires Node.js 22+ and npm 10+.

```powershell
git clone https://github.com/ryuga-w/quake-code-desktop.git
cd quake-code-desktop
npm ci
npm run desktop:dev
```

Create a branch from `main` and keep each pull request centered on one outcome.

## Required checks

Run these commands from the repository root:

```powershell
npm run verify:public-source
npm run typecheck
npm test
```

For installer or Electron-host changes, also run:

```powershell
npm run desktop:package:win
```

## Pull requests

In the pull request:

1. Explain the problem and the chosen solution.
2. Describe how you verified the behavior.
3. Add screenshots or a short recording for visible UI changes.
4. Call out security, permission, migration, or compatibility effects.
5. Update user-facing documentation when behavior changes.

Do not commit generated release directories, credentials, user sessions, `.env.local`, or local `.quake-code/` data.

## Security-sensitive changes

Changes that add a provider, external tool, browser/desktop capability, or new IPC/API path must document:

- where credentials and sensitive state are stored;
- which process can access them;
- the user approval boundary;
- workspace/path validation;
- failure and cancellation behavior.

Provider secrets must never be moved into renderer or browser code.

## Style and scope

- Follow the existing TypeScript and React patterns around the code you change.
- Prefer tests that verify behavior over snapshots of implementation details.
- Keep localization keys aligned in Turkish and English.
- Avoid unrelated refactors in the same pull request.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
