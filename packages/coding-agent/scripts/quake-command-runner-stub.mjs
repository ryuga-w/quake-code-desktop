#!/usr/bin/env node
/**
 * Compatibility entry for QUAKE_COMMAND_RUNNER (historical stub path).
 *
 * Real MVP runner lives at `quake-command-runner.mjs` (same directory).
 * This file re-exports that implementation so existing env/docs/tests that
 * point at `quake-command-runner-stub.mjs` keep working.
 *
 * Not RestrictedToken isolation — see quake-command-runner.mjs header.
 */
import "./quake-command-runner.mjs";
