# Archive — superseded documents

These files are kept for history only. They describe the **native panel (pre-3.0.0)** and versions
2.2.0–2.3.x. Do not treat them as current rules, architecture or runbooks. For anything current start
with `AGENTS.md`, `ARCHITECTURE.md`, `HANDOFF.md`, `CHANGELOG.md`, `UPDATE.md`.

| File | What it is | Replaced by |
|---|---|---|
| `PROJECT_STATE_2026-11-06.md` | Snapshot during the v1 sequential batch work: bounds/`isValid` debugging, warm daemon launch hardening, CEP cache findings | `CHANGELOG.md`, `HANDOFF.md` |
| `PROJECT_STATE_2026-11-10.md` | Snapshot at v2.2.0: parallel batch, history, warm daemon, modular panel/host/agent | `ARCHITECTURE.md` (3.0.0), `CHANGELOG.md` |
| `CHANGES_2026-11-06.md` | Change-by-change record of the 2026-11-06 batch/SVG-history work, including the panel markup of the time | `CHANGELOG.md` |
| `CHANGES_2026-11-13.md` | Change-by-change record of 2.3.13 → 2.3.24 (Mockup Studio renaming, panel work) | `CHANGELOG.md` |
| `INSTALLER_CHANGES_2026-11-11.md` | Audit of five installer/uninstaller defects and their fixes | `INSTALL.md`, `UPDATE.md` |
| `UI_UX_RESEARCH_2026-11-11.md` | Research notes on improving the native panel's UX | `DESIGN.md`, `ARCHITECTURE.md` |
| `ARCHITECTURE_PLAN.md` | **Unimplemented proposal** for a tabbed multi-tool shell (`js/shell/`, module registry, SKU resolver, Gemini module) with open questions | `ARCHITECTURE.md`; the multi-tool idea was never built and would need a fresh design against the React panel |
| `RELEASE_PROMPT.md` | Historical runbook for publishing 2.3.1 (repository visibility decision, `gh release create`, digest checks) | `UPDATE.md` ("For maintainers"), `AGENTS.md` |

Why archive rather than delete: the release runbook still documents the one-time visibility decision and
the unauthenticated-API check, and the snapshots record why specific host/agent guards exist. Nothing
here is authoritative, and several commands in `RELEASE_PROMPT.md` are now wrong (its archive list has
no `dist/`, its version and HEAD are obsolete).

Archived on 2026-11-24 when the panel moved to the React build (v3.0.0). Add new history to
`CHANGELOG.md` and `HANDOFF.md` rather than reviving dated snapshot files.
