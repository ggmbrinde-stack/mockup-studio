# Mockup Studio — Approved AI Tool Belt

This is an **inventory and activation policy**, not an installer and not a claim that anything is
available in your session. Verified on this machine on **2026-11-12**; re-verify before relying on it.

Read this when a task might benefit from a specialist capability. `AGENTS.md` rules, `DESIGN.md`
standards and the Basic/Extended/Critical QA levels apply **regardless of what is installed here**. A
skill is guidance, never permission to install, publish, spend money or widen scope.

## Status vocabulary

- **Installed and verified** — present on disk and actually exercised in this environment.
- **Configured but untested** — present and registered, never successfully run here.
- **Selected but not installed** — approved in Notion, absent from this machine.
- **Not applicable** — the entry does not fit this project's runtime.

## The nine approved entries

| # | Entry | Status here | Evidence | Use when |
|---|---|---|---|---|
| 1 | **shadcn-first-ui** (custom skill) | **Selected but not installed** | `~/.claude/skills` is empty; `~/.codex/skills` holds only `.system`; no project skills directory | Any component selection, reuse or native adaptation. Not for a padding tweak |
| 2 | **Impeccable** ([repo](https://github.com/pbakaus/impeccable)) | **Selected but not installed** | Not present in any skills directory | One bounded visual critique/polish pass on substantial UI work |
| 3 | **Grill Me** ([repo](https://github.com/mattpocock/skills)) | **Selected but not installed** | Not present | Requirements for a complex feature are materially unclear. Never for small edits |
| 4 | **Focused Design Skills** (category) | **Not applicable as a package** | Category, not a product | Narrow typography/layout/colour problem — use a specific skill if one exists, otherwise do the check by hand |
| 5 | **Jakub's Design Skills** ([repo](https://github.com/jakubkrehel/skills)) | **Selected but not installed** | Not present | Targeted type/spacing/layout polish |
| 6 | **Pick UI Library** ([repo](https://github.com/emilkowalski/skills)) | **Selected but not installed** | Not present | Specialist component beyond local + shadcn + approved registries. Requires explicit invocation |
| 7 | **Astryx** ([repo](https://github.com/meta/astryx)) | **Not applicable** | Not React | Only if this project ever gains a React surface |
| 8 | **ScrollCraft** ([repo](https://github.com/nateherkai/scroll-craft)) | **Not applicable** | Dockable CEP panel, not a scrolling site | Scroll-driven web experiences elsewhere |
| 9 | **Humanizer** | **Configured (Codex only), untested** | `~/.codex/AGENTS.md` carries Humanizer rules globally | Refining prose. Not a skill folder; the rules live in Codex's global instructions and do **not** apply to other agents |

**Component-source policy** (independent of the belt): existing local patterns → shadcn/ui as a
reference → Kibo UI / Origin UI / reviewed shadcn registries → Pick UI Library for a specialist need.
Magic UI is an optional animation reference. These are **sources**, not additional installations. In
this project everything must end up as native HTML/CSS/JS — no JSX, no Tailwind, no build step.
shadcn/ui itself has no MCP connection and no components in this repository.

## Existing capabilities in this environment

| Capability | Status | Where / evidence |
|---|---|---|
| **Pen desktop (pen.dev)** | **Installed and verified** | `%LOCALAPPDATA%\Programs\Pen\Pen.exe`, version **1.2.22.0** |
| **Pen MCP server (`pencil`)** | **Configured but untested** | `~/.claude.json` (`--agent claudeCodeCLI`), `~/.codex/config.toml` (`--agent codexCLI`), `~/.config/opencode/opencode.json` (`--agent openCodeCLI`). Binary: `…\Pen\resources\app.asar.unpacked\out\mcp-server-windows-x64.exe`. No handshake was performed |
| **Pen `pen-dev` skill** | **Installed and verified (inside Pen)** | `…\Pen\resources\app.asar.unpacked\out\skills\pen-dev`. It is Pen's own canvas skill; it is not visible to chat agents |
| **Pen agent integrations (declared)** | **Configured but untested** | Pen `config.json` `enabledIntegrations`: `claudeCodeCLI, codexCLI, geminiCLI, antigravity, openCodeCLI, kiroCLI, claudeDesktop` |
| **Codex built-in skills** | **Installed and verified (Codex only)** | `~/.codex/skills/.system/{imagegen,openai-docs,review-agent}` |
| **Cursor built-in skills** | **Installed and available (Cursor only)** | `~/.cursor/skills-cursor/*` incl. `review`, `canvas`, `create-skill`, `deploy-with-vercel` |
| **Notion** | **Freebuff chat only** | Verified readable from the Freebuff chat session. **No Notion MCP for this workspace** — the only `notion` server is in `..\..\opencode.json`, which belongs to the parent Magento workspace |
| **GitHub** | **CLI only, unverified** | No GitHub MCP anywhere. `RELEASE_PROMPT.md` describes `gh` usage; this audit did not use it |
| **Regression harness** | **Installed and verified** | `../tools/verify-host.cjs` — 22 checks, all passing at 2.3.3 |
| **Illustrator host testing** | **Installed and verified** | Adobe Illustrator 2025, 2026 and 2027 are installed; CEP copy is in sync and byte-identical to source |

Nothing above was installed, upgraded or connected during Phase 1/2.

## Task-based activation

| Request | Route |
|---|---|
| "Fix this button spacing" | Fast workflow, mandatory checks, **no specialist skill** |
| "Add a reusable control" | shadcn-first-ui **if installed**; otherwise apply its procedure manually and say so |
| "Redesign the panel" / significant UI work | Full workflow + **one** bounded polish pass; Impeccable if installed, otherwise a manual critique |
| "Plan this complex feature, don't build" | Planning only; Grill Me if key requirements are unresolved |
| "Improve this paragraph" | Humanizer rules where available (Codex); otherwise direct editing |
| "Design this screen in pen.dev" | pen.dev canvas, then update the Design ↔ Code Sync table in `DESIGN.md` |
| "Continue from the previous agent" | `AGENTS.md` → `HANDOFF.md` → verify actual Git state and files |

Use one or two meaningful skills for ordinary work; more only when risk or uncertainty justifies it.
Installing a skill does not make it run: explicit-invocation entries (Pick UI Library) must be called.

## Rules

- **Never install** a skill, dependency, MCP server or account without explicit approval. Do not
  bulk-install, run unreviewed scripts from GitHub, or incur paid usage.
- **Never claim** a skill ran when it did not. If it is unavailable, apply the equivalent documented
  checks directly and say the skill was absent.
- Skills do not replace mandatory QA, `DESIGN.md` standards, accessibility, localization or the
  approval boundaries in `AGENTS.md`.
- Verify provenance, license and dependencies before proposing an install; record what actually gets
  installed in this file with version, path and the agent it belongs to.
- Do not add a skill to this file as "installed" without having run it once.
