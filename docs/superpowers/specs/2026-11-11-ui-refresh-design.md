# UI refresh: indigo theme + polish

Date: 2026-11-11 · Status: awaiting owner review

## Intent

The owner finds the current UI too plain/grey, cramped, and hard for new users
to understand. Goal: a refresh that looks better and a little different, while
**layouts, navigation and features stay the same** ("Theme + polish" depth).

Success: every page uses the indigo accent and Inter UI font in light and dark
mode, each main page explains itself in one line, and nothing behaves
differently.

## Decisions (owner-approved)

| Topic | Decision |
|---|---|
| Depth | Theme + polish; no layout or flow changes |
| Accent | Indigo/violet |
| Fonts | Inter for UI chrome (default; Appearance overrides still win); Source Sans 3 prose and CMU Serif titles unchanged |
| Focus | Replace the "no-ring law": no outline on mouse focus; soft indigo ring on `:focus-visible` and text inputs |
| Helper text | Yes: page subtitles, clearer empty states, tooltips; EN + JA |
| Build approach | Tokens + touch-ups (no new shared primitives, no UI library) |

## Section 1: tokens (`app/globals.css`)

| Token | Light | Dark |
|---|---|---|
| `--primary` | `#4f46e5` | `#818cf8` |
| `--primary-foreground` | `#ffffff` | `#0f0f1a` |
| `--accent` | `#eef0ff` | `#232340` |
| `--ring` | `rgb(99 102 241 / 0.4)` | `rgb(129 140 248 / 0.4)` |
| `--radius` | `10px` | `10px` |
| `--font-ui` | Inter (loaded with `next/font/google` in `app/layout.tsx`, exposed as a CSS variable), then current system stack | same |

`--background`, `--card`, `--border`, `--input`, `--muted*`, `--destructive`
are unchanged in both modes (dark keeps the owner's `#141414 / #1c1c1c / #434343`).
Both the `prefers-color-scheme` block and the `.dark` class block get the dark values.

Focus rule replaces the current `*:focus, *:focus-visible { outline: none }`:
- `*:focus { outline: none }` stays.
- `:focus-visible` on interactive elements and `input, textarea, select` on
  `:focus` get `box-shadow: 0 0 0 3px var(--ring)`.
- The rule's comment is rewritten to record the owner's 2026-11-11 decision.

## Section 2: per-surface polish

- **Sidebar** (`components/sidebar.tsx`): active session = `bg-accent` + 2px
  indigo left marker; section headers ("Teaching", "Practice") become
  `text-xs uppercase tracking-wide text-muted-foreground`; row padding +1 step.
- **Home** (`app/page.tsx`) and **New chat** (`app/chat/new/page.tsx`): title + subtitle.
- **Chat** (`components/chat.tsx`, `components/composer.tsx`): composer gets a
  raised card look (`bg-card`, border, `shadow-sm`); send button uses
  `bg-primary text-primary-foreground` (replaces the hard-coded grey at
  `composer.tsx:142`); message spacing re-checked with Inter.
- **Knowledge / Settings / Preferences**: title + subtitle; cards, inputs and
  buttons inherit tokens, with any remaining hard-coded neutrals switched to tokens.
- **Login / Signup** (`components/auth-form.tsx`): keep the 2026-11-11 redesign;
  picks up indigo automatically.
- **Tooltips**: icon-only buttons without an accessible label get a `title` +
  `aria-label` from the locale files.
- **Intentionally unchanged**: `bg-white` diagram holders
  (`artifacts/visual-card.tsx`, `session-overlay.tsx`), `bg-black/50` dialog
  backdrop, `ui/button.tsx` destructive `text-white`.

## New copy (EN; JA to be added alongside)

| Key | English |
|---|---|
| `pages.homeSubtitle` | Pick up a session or start learning something new. |
| `pages.newChatSubtitle` | Tell the tutor what you want to learn. It will teach, quiz you, and remember your progress. |
| `pages.knowledgeSubtitle` | Everything you've learned, as a graph. |
| `pages.settingsSubtitle` | Models, keys and app options. |
| `pages.preferencesSubtitle` | How the tutor teaches you and how the app looks. |

Japanese strings are written in the implementation and listed in the PR for the
owner to check. Tooltip strings are listed in the implementation plan once the
unlabeled buttons are enumerated.

## Testing

- `npx tsc --noEmit` and existing lint (including the import-law lint).
- Run the dev server; screenshot home, new chat, an existing chat, knowledge,
  settings, preferences, login in light and dark mode.
- Check keyboard Tab shows the ring and mouse clicks do not.

## Out of scope

Layout restructuring, new navigation, new components/primitives, UI libraries,
any behavior change.
