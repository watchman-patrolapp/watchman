# Watchman design system

Small token layer for `platform/web`. Dark mode is the `dark` class on `<html>`. Brand teal is `#0d9488`.

## Tokens

CSS variables live in `src/index.css` (`:root` and `.dark`). Tailwind maps them in `tailwind.config.js`, so a utility follows the active theme without a `dark:` twin.

| Token | Tailwind | Use |
| --- | --- | --- |
| `--color-primary-600` `#0d9488` | `bg-primary-600`, `accent-color` | Brand accent, checkboxes, large UI. Not small text. |
| `--color-primary-700` `#0f766e` | `bg-primary`, `text-text-link` (light) | Primary buttons and light-mode links. Passes 4.5:1 with white. |
| `--color-success`, `--color-warning`, `--color-danger`, `--color-info` | `bg-success`, `bg-warning`, `bg-danger`, `bg-info` | Solid buttons. Pair with white text. |
| `--color-*-light` / `--color-*-text` | `bg-success-light`, `text-success-foreground` (same for warning, danger, info) | Badges and quiet status fills. |
| `--color-bg-*` | `bg-surface-page`, `bg-surface-card`, `bg-surface-secondary`, `bg-surface-inset`, `bg-surface-input` | Page, card, and field surfaces. |
| `--color-border-*` | `border` (default), `border-subtle`, `border-strong` | Hairline, default, and strong strokes. |
| `--color-text-primary` | `text-text-primary` | Headings and body. |
| `--color-text-secondary` | `text-text-secondary` | Supporting copy. |
| `--color-text-tertiary` | `text-text-tertiary` | Helper text. Must stay at 4.5:1. |
| `--color-text-link` | `text-text-link` | Inline links. |
| `--color-focus` | global `:focus-visible` | Keyboard focus ring. |

`accent-color` on `html` is the brand teal so checkboxes and radios are not the browser purple.

Primary buttons use a 2px inset edge (`--color-primary-edge`). In dark mode that edge is `#5eead4`, so the control stays distinct from the dark card while the fill keeps white text at 4.5:1.

Re-check pairs with:

```bash
cd platform/web && npm run contrast
```

The script writes `platform/docs/CONTRAST_REPORT.md` and exits non-zero if a listed pair drops below AA.

## Primitives

Shared controls are in `src/components/ui/`:

- `Button` — `primary`, `secondary`, `success`, `danger`, `ghost`. `loading` disables the button, sets `aria-busy`, and shows a spinner.
- `IconButton` — requires `label`, sets `aria-label`, and keeps a 44px hit area.
- `FormField` — visible label, optional hint, error with `role="alert"`. Native inputs get `aria-invalid` and `aria-describedby`. `FieldErrorContext` can supply errors by field id.
- `EmptyState`, `ErrorState` (retry button), `Skeleton`.

Use these on new work. Login, Register, Dashboard, ResidentDashboard, IncidentList, and IncidentForm already do.

## App chrome

- Skip link is the first focusable control and targets `#main-content`.
- `:focus-visible` draws a 2px ring. `prefers-reduced-motion: reduce` is already handled in `index.css`.
- Toasts: bottom-center on viewports under 768px, above the tab bar and safe area; top-right from `md`. Success lasts 2 seconds. Errors last 8 seconds. `src/utils/notify.js` gives identical string messages the same id so a repeat replaces the current toast. Pass `retry` on `toast.error` when the action can be run again.
- Offline banner copy is fixed: “You’re offline. Some actions will wait until you reconnect.”

## Auth

Login and register keep their existing submit logic. The shell adds the mark, the line “Keep your neighbourhood safe together”, a labelled theme control, and links to `/privacy` and `/terms`. Those pages are short public drafts. They do not invent a company number or contact email; the privacy page shows `VITE_PRIVACY_CONTACT_EMAIL` when it is set.
