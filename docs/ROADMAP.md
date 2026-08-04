# Roadmap

Quake Code Desktop is an early-stage, Windows-first coding-agent workspace. This roadmap communicates direction, not fixed delivery dates. Priorities may change as reliability, security, and user feedback evolve.

## Current focus — dependable `0.1.x`

- Keep the agent, file, terminal, browser, MCP, subagent, and scheduled-work surfaces coherent.
- Harden permission prompts, workspace boundaries, cancellation, and error recovery.
- Expand regression coverage for the packaged Windows experience.
- Keep installer artifacts reproducible and checksummed.
- Improve onboarding, diagnostics, accessibility, and bilingual documentation.

## Next

- Establish a sustainable Windows code-signing and update path.
- Improve session and task observability for longer-running agent work.
- Make provider and MCP setup easier to validate and troubleshoot.
- Broaden end-to-end coverage across permissions, files, terminal, browser, and settings.
- Refine extension and tool presentation without hiding the actions an agent takes.

## Exploring

- Additional operating-system packages after the Windows experience is stable.
- Safer remote or companion access with an explicit authentication model.
- More portable workspace and settings workflows.
- Richer collaboration and agent handoff patterns.

Items in **Exploring** are not commitments. Open a [feature request](https://github.com/ryuga-w/quake-code-desktop/issues/new?template=feature_request.yml) with the problem, expected users, and safety implications if you want to help shape a priority.

## Product principles

1. **Actions stay inspectable.** Agent activity should be visible and understandable.
2. **Power follows consent.** High-impact tools need clear boundaries and revocation paths.
3. **Local state stays owned by the user.** Remote provider access is explicit and configurable.
4. **Reliability precedes surface area.** A smaller dependable workflow is better than a larger fragile one.
5. **Claims match shipped behavior.** Documentation and releases describe what is available now.
