# UI Refresh (Indigo Theme + Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the whole app with an indigo accent, Inter UI font, soft focus ring and clearer helper text, without changing layouts or behavior.

**Architecture:** Nearly every component reads theme tokens, so most of the change lives in `app/globals.css`. A few components get targeted class edits, and new copy goes into `locales/en.json` + `locales/ja.json` (typed via `LocaleCatalog = typeof en`, so JA must carry every new key).

**Tech Stack:** Next.js (repo's version — read `node_modules/next/dist/docs/` before touching `next/font`), Tailwind v4 `@theme`, node:test via `npm test`.

**Spec:** `docs/superpowers/specs/2026-11-11-ui-refresh-design.md`

## Global Constraints

- Indigo: `--primary` `#4f46e5` light / `#818cf8` dark; `--primary-foreground` `#ffffff` / `#0f0f1a`; `--accent` `#eef0ff` / `#232340`; `--ring` `rgb(99 102 241 / 0.4)` / `rgb(129 140 248 / 0.4)`; `--radius` `10px`.
- `--background`, `--card`, `--border`, `--input`, `--muted*`, `--destructive` unchanged in both modes.
- No layout, navigation or behavior changes.
- Every new copy key exists in both `en.json` and `ja.json`.
- Leave alone: `bg-white` diagram holders, `bg-black/50` backdrop, `ui/button.tsx` destructive `text-white`, green "Next problem" button.

## Review Focus

1. Dark mode via **both** paths: OS `prefers-color-scheme` and the `.dark` class toggle must both show indigo.
2. Appearance setting font override must still win over Inter.
3. Mouse click on a button shows no ring; Tab shows the ring (the original reason for the no-ring law: quiz ←/→ keys lit a clicked sidebar row).
4. `bg-accent` is now indigo-tinted, so dense `hover:bg-accent` surfaces (sidebar, menus) must stay readable in dark mode.
5. Japanese copy must not be mojibake (covered by `tests/i18n-encoding.test.ts`).

---

### Task 1: Theme tokens, Inter font, focus rule

**Files:**
- Modify: `app/globals.css` (`:root` block, both dark blocks, focus rule at top, `--font-ui`)
- Modify: `app/layout.tsx` (load Inter)
- Test: `tests/theme-tokens.test.ts` (new)

**Interfaces:** Produces CSS variable `--font-inter` (set by `next/font` on `<html>`); `--font-ui` becomes `var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif`.

- [ ] **Step 1: Write failing test** `tests/theme-tokens.test.ts` — reads `app/globals.css` as text and asserts: `--primary: #4f46e5;` present once in `:root`; `--primary: #818cf8;` present in **both** the `prefers-color-scheme: dark` block and the `.dark` block; `--radius: 10px;`; `--font-ui:` line contains `var(--font-inter)`; the CSS contains `:focus-visible` with `box-shadow: 0 0 0 3px var(--ring)`.
- [ ] **Step 2: Run** `npm test -- tests/theme-tokens.test.ts` → FAIL.
- [ ] **Step 3:** Apply the Global Constraints token values. Replace the focus rule: keep `*:focus { outline: none }`, add `:focus-visible` (all elements) and `input:focus, textarea:focus, select:focus` → `box-shadow: 0 0 0 3px var(--ring)`. Rewrite the rule's comment: "Owner decision 2026-11-11: soft indigo ring on keyboard focus and text inputs; still no outline on mouse focus." Fix the stale "Mono chrome = JetBrains Mono" comment to "UI chrome = Inter".
- [ ] **Step 4:** In `app/layout.tsx`, `import { Inter } from "next/font/google"`; `const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" })`; add `inter.variable` to `<html className>`.
- [ ] **Step 5: Run** `npm test -- tests/theme-tokens.test.ts` → PASS; `npm run typecheck` → no errors.
- [ ] **Step 6: Commit** `style: indigo theme tokens, Inter UI font, soft focus ring`.

### Task 2: Sidebar active marker

**Files:** Modify `components/sidebar.tsx:303-305` and `:346`.

- [ ] **Step 1:** On the session row (`active && "bg-accent"`) add `before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary` (row is already `relative`). Apply the same marker to the row at `:346`. Change row padding `py-2` → `py-2.5` on both.
- [ ] **Step 2:** `npm run typecheck && npm run lint` → clean.
- [ ] **Step 3: Commit** `style: indigo marker on active sidebar session`.

### Task 3: In-chat composer card + send button

**Files:** Modify `components/chat.tsx` (the element wrapping `<Composer>` in the chat view), `components/composer.tsx` (send button).

- [ ] **Step 1:** Give the chat view's composer wrapper the same classes as `new-session.tsx`: `overflow-hidden rounded-2xl border bg-card shadow-lg` (skip if it already has them).
- [ ] **Step 2:** In `composer.tsx`, the send (submit) button — not `next-problem-button` — uses `bg-primary text-primary-foreground hover:bg-primary/90`; remove any hard-coded neutral color on it.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → clean.
- [ ] **Step 4: Commit** `style: raised composer card and indigo send button in chat`.

### Task 4: Helper copy (subtitles)

**Files:** Modify `locales/en.json`, `locales/ja.json`, `components/settings/settings-dialog.tsx:278-279`, `components/preferences-form.tsx:26-29`. Test: `tests/locale-keys.test.ts` (new).

**Interfaces:** New keys `settingsUi.subtitle`, `preferences.subtitle`; changed `newSession.description`.

- [ ] **Step 1: Write failing test** `tests/locale-keys.test.ts`: recursively collect key paths of `en.json` and `ja.json`; assert equal sets; assert `en.settingsUi.subtitle === "Models, keys and app options."`, `en.preferences.subtitle === "How the tutor teaches you and how the app looks."`, `en.newSession.description === "Tell the tutor what you want to learn. It will teach, quiz you, and remember your progress."`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** Add the EN strings above. JA:
  - `settingsUi.subtitle`: `モデル、APIキー、アプリの設定。`
  - `preferences.subtitle`: `チューターの教え方とアプリの見た目。`
  - `newSession.description`: `学びたいことをチューターに伝えてください。教えて、クイズを出し、進み具合を覚えています。`
- [ ] **Step 4:** Render `<p className="text-sm text-muted-foreground">{copy.preferences.subtitle}</p>` under the Preferences `<h1>` (wrap h1+p in a `div`). In the Settings header, wrap the `<h2>` and a `<p className="text-xs text-muted-foreground">{copy.subtitle}</p>` in a `div`; header height `h-15` may become `py-3` so both lines fit.
- [ ] **Step 5: Run** `npm test` (incl. `i18n-encoding`) and `npm run typecheck` → PASS.
- [ ] **Step 6: Commit** `feat: page subtitles and clearer new-session copy (en, ja)`.

### Task 5: Tooltips on unlabeled icon buttons

**Files:** Whatever `components/**/*.tsx` buttons the audit finds; `locales/en.json`, `locales/ja.json`.

- [ ] **Step 1:** List every `<button>` whose only child is an icon and that has no `aria-label` or `title`. Write the list (file:line + proposed EN/JA label) into the PR description and **stop for owner approval of the strings** (AGENTS.md: no guessing copy).
- [ ] **Step 2:** After approval, add the keys to both locales and set `aria-label` and `title` from `copy`.
- [ ] **Step 3:** `npm test && npm run typecheck && npm run lint` → clean.
- [ ] **Step 4: Commit** `feat: tooltips on icon-only buttons`.

### Task 6: Visual verification

- [ ] **Step 1:** Start the dev server (`preview_start`, add a `.claude/launch.json` entry for `npm run dev` if missing).
- [ ] **Step 2:** Screenshot in light and dark: `/` , `/chat/new`, an existing `/chat/[id]`, `/knowledge`, `/preferences`, Settings dialog, `/login`.
- [ ] **Step 3:** Check Review Focus 1–4 by hand (toggle `.dark` class, Appearance font override, Tab vs click, sidebar hover in dark).
- [ ] **Step 4:** Fix anything found, re-run `npm test && npm run typecheck && npm run lint`, commit `style: refresh fixes from visual pass`.
