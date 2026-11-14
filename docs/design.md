# Nora HQ design system: "Ink"

Paper, ink, one seal. The page is paper-white, the text is near-black, and structure comes from
hairlines and whitespace instead of boxes. A serif (Newsreader) sets the titles; the device's own
UI font sets everything else. Colour appears in three places only: the cinnabar primary action,
the counts that are waiting on you, and a 7px status dot.

The product rule behind it: simplicity is the ultimate sophistication, less is more. It has to work
as well on a phone as on a desktop, in light and in dark.

## Where things live

| What | Where |
|---|---|
| Tokens (colour, type, space, shape), base rules, shared classes, the shell | `src/app/globals.css` |
| Classes for one area of the app | `src/app/styles/<area>.css` (`home-inbox`, `business`, `calendar-tasks`, `grow`, `public-settings`) |
| Shared components | `src/components/ui.tsx` (and `client-form.tsx`, `view-toggle.tsx`, `phone-disclosure.tsx`, `copy-button.tsx`, `upload-picker.tsx`) |
| Shell: sidebar, phone top row, tab bar, More sheet | `src/components/sidebar.tsx`, `src/components/section-tabs.tsx`, `src/app/(app)/layout.tsx` |
| The display font | `@fontsource-variable/newsreader/opsz.css`, imported in `src/app/layout.tsx` (self-hosted, no font requests to a third party) |

Cascade layers, lowest to highest: `theme`, `base`, `components` (the shared classes), `pages`
(the per-area stylesheets), `utilities` (Tailwind). So an area class refines a shared class, and a
Tailwind utility on the same element still wins over both. A few rules are unlayered on purpose and
beat everything: the focus ring, the selection colour, 16px inputs on touch.

## Colour

All values are tokens in `globals.css` (light and dark). Use them as `var(--token)` or through the
Tailwind aliases (`bg-surface`, `text-muted`, `border-border-strong`, `text-faint`, ...).

- `--bg` is paper. `--surface` is only for things that sit above the page: inputs, checkboxes,
  sheets, menus. Sections have no background.
- `--text` is ink. `--muted` is secondary text (passes AA on `--bg`, `--surface` and `--surface-2`).
- `--border` is the hairline between rows. `--border-strong` outlines inputs, checkboxes and
  secondary buttons at 3:1. `--faint` is for chevrons and other glyphs, never for words.
- `--accent` is cinnabar: the primary button, the phone "+", counts that need you (as plain coloured
  numerals), today's date numeral. Nothing else. Links are ink with a thin underline.
- `--ok --warn --danger --info` colour the status dot, and the words "Due today" (warn) and
  "Overdue" (danger). Never a filled pill. The `-soft` tokens stay defined for old code; new work
  does not use them.
- `--ig --tt --google --facebook` are a 7px dot before the handle or platform name; the name itself
  is ink.
- Selection and the selected filter chip are inverse: ink background, paper text.

Every text pair passes WCAG AA (4.5:1) and every outline, glyph and the focus ring passes 3:1, in
light and in dark. Keep it that way when a value changes.

## Type

Two faces. Serif for titles, sans for everything else. Sans weights are 400, 500, 600 (never 700).

| Role | Class | Face | Desktop | Phone (<768px) | Weight | Tracking |
|---|---|---|---|---|---|---|
| Page title | `.display` | Newsreader | 40 / 44 | 32 / 35 | 450 | -0.02em |
| Section title | `.title` | Newsreader | 21 / 28 | 22 / 28 | 500 | -0.01em |
| Row title | `.row-title` | sans | 15 / 22 | 16 / 24 | 500 | 0 |
| Body, status words | (body) | sans | 15 / 22 | 16 / 24 | 400 | 0 |
| Meta | `.meta` | sans | 13 | 14 | 400, `--muted` | 0 |
| Eyebrow (group labels, table heads) | `.eyebrow` | sans, caps | 11 / 16 | 12 / 16 | 600, `--muted` | 0.07em |
| Count that needs you | `.count` | sans, tabular | 13 | 14 | 600, `--accent` | 0 |
| Sidebar link | | sans | 14 / 22 | | 400, 600 when current | 0 |
| Tab bar label | | sans | | 11 / 14 | 500, 600 when current | 0 |
| Agenda day numeral, a figure | `.serif` + a size | Newsreader | 24 to 28 | same | 450 | -0.01em |
| Wordmark "Nora HQ" | `.wordmark` | Newsreader | 22 | 19 | 500 | -0.01em |

- Body text takes no size class: it inherits 15 / 22 (16 / 24 on phones) from `body`.
- Tailwind's `text-xs`, `text-sm` and `text-base` are the same tokens (`--text-xs`, `--text-sm`,
  `--text-base`): 11, 13 and 15px on desktop, 12, 14 and 16px on phones. So `text-sm` is meta size,
  not body size, and `text-xs` is for caps labels only.
- Numbers that line up use tabular figures (`.num`). Newsreader uses lining figures.
- Everything on a row shares one baseline (title, meta, status, button). Buttons are built so their
  label sits on the surrounding text's baseline.
- Chinese: Newsreader has no CJK glyphs. Both font stacks end in CJK fallbacks (PingFang, Hiragino,
  Microsoft YaHei, Noto Sans SC). Under `:lang(zh)` the display face becomes the sans at weight 600
  with no tracking, and `:lang(zh-Hant)` swaps in the Traditional fonts (PingFang TC, JhengHei,
  Noto Sans TC). An element with a `lang` attribute picks its stack up, so the owner-facing shells
  (which already set `lang`) need nothing else.
- Emoji are drawn in greyscale with `.emoji` so a camera or a pin does not break the monochrome.

## Space and shape

- 4px steps. Page padding: desktop 44px top, 56px sides (32px between 768 and 1023px, where the
  sidebar already took 280px), 64px bottom; phone 16px sides (safe-area aware) and tab bar height
  plus 24px at the bottom. Content is left-aligned, at most 1080px wide.
- Sections are 40px apart (32px on phones). Two columns on desktop (`.cols`): `1fr` plus a 300px
  side column, 64px gap; one column under 1200px.
- Rows are 44px tall with a mouse and 48px on touch; text sits on a 22px (24px on phones) line.
- Radii: 4px tags, checkboxes, kbd. 6px buttons, inputs, nav rows. 14px sheets, dialogs, the phone
  "+". Pill for filter chips and the switch. Sections and lists have no radius because they have no
  box. Tailwind's scale is folded onto these: `rounded-xs` and `rounded-sm` are 4px, `rounded-md`
  and `rounded-lg` are 6px, `rounded-xl` and above are 14px.
- Shadows: none. The single exception is `--shadow-pop` on things that float (the More sheet,
  menus, dialogs, toasts). Tailwind's `shadow-sm` and `shadow-md` draw nothing; `shadow-lg` and
  above draw `--shadow-pop`.
- Breakpoints: 768px (sidebar or tab bar, phone type sizes), 1024px (rows go from two lines to one
  line with columns), 1200px (two-column pages). Touch sizes follow
  `(max-width: 767px), (pointer: coarse)`.

## Sections, lists, dividers (this replaces the card)

```
────────────────────────────────  1px ink rule (--rule-ink)
To approve 18          See all →  serif title, cinnabar count, quiet link; 12px above, 6px below
TikTok DM to @mindofkici   Crab O Clock   2h ago  ›
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  1px hairline (--rule) between rows only
Email to Myah the Beauty   S&F Massage…   5h ago  ›
```

- A section is `.sec`: an ink rule, then `.sec-head` (title left, one quiet action right), then
  content. No background, no border, no radius, no padding box. Content starts at the same left
  edge as the title. `<Card>` / `<Section>` draws exactly this.
- A section brings its own 40px top margin, except inside a parent that already spaces its children
  (a grid, a flex column, a `space-y-*` stack): give that parent `gap-10`.
- A list is `.list` (a `ul` of `li`): hairline between rows, none above the first or below the
  last. A list with no title of its own (the health strip) adds `.is-ruled` for a hairline top and
  bottom.
- A row is `.row`: baseline-aligned flex or grid, 44 / 48px tall. Wide: one line, with fixed
  right-hand columns so lists line up (business 168px, when 76px, chevron 14px, 16px gaps). Narrow
  (under 1024px): two lines, the title and then one `.row-meta` line whose facts are joined by "·".
- Group labels inside a list (schedule days) are `.eyebrow` with a hairline under them; "Today" is
  the same label in `--accent`, right-aligned.
- Hover on a row underlines its title. No hover fills inside lists.
- A warning or a note that used to be a soft-coloured box is `.notice`: one row between two
  hairlines, a `.status.is-warn` and then the action as an ink `.link`.
- An empty list is `.empty`: a 500 ink line and a muted 13px line, left-aligned, no box.

## Controls

- **Buttons** `.btn`: 36px (44px touch), 6px radius, 14px sides, 14px / 500 label (16px on phones).
  `.btn-primary` cinnabar fill, 600 weight, one per screen. `.btn-secondary` 1px `--border-strong`
  outline, ink label; hover darkens the outline. `.btn-ghost` no outline, muted label; hover
  `--surface-2`. `.btn-danger` outline with `--danger` label. `.btn-sm` 28px with a mouse, 44px on
  touch. Use `buttonClass(variant, size)`, `<Button>` or `<LinkButton>`.
- **Chips** (filters) `.chip` inside `.chips`: pill, 1px `--border-strong`, 13px / 500, count in
  muted tabular figures (`<i>`). Selected (`aria-pressed="true"` on a button, `aria-current` on a
  link): ink fill, paper text. The button is 44px tall on touch; the pill drawn inside is 34px.
  Markup: `<button class="chip" aria-pressed="true"><span>All <i>37</i></span></button>`.
- **Tags** `.tag` (`<Tag>`): a fact about a row (Free, Creator, From Oct). 18px tall, 4px radius,
  hairline outline, 11px / 600 caps, muted. Never coloured.
- **Status** `.status.is-ok|is-warn|is-danger|is-info|is-idle|is-accent` (`<Status tone>`): a 7px
  dot and plain words. Words are ink, except `is-ok` and `is-idle` which are muted (nothing to do).
  `is-idle` is a hollow dot. This replaces every soft-coloured pill. Platforms are the same thing:
  `.status.is-ig|is-tt|is-google|is-facebook` (`<PlatformTag>`).
- **Counts** `.count` (`<Count>`): a cinnabar numeral, no pill (sidebar, section titles, tabs). The
  only filled badge left is the 18px one on the phone tab icons.
- **Inputs** `.input`: 36px (44px touch), 1px `--border-strong`, 6px radius, `--surface` fill, 14px
  text (16px on phones and touch). Placeholder `--muted`. Focus: the border turns ink and doubles to
  2px. `.label` is 13px / 500 ink, 6px above the field. `.hint` is 13px muted, 6px below.
- **Checkbox** `.check`: 18px (22px touch) square, 1.5px `--border-strong`, 4px radius. Checked: ink
  fill with the `--check-mark` tick in the page colour. A plain checkbox without the class still
  prints in ink (`accent-color`). The task tick (`.tick`, with an `<i>` inside) is the same square
  inside a 44px button on touch.
- **Switch** `.switch` with `.switch-track`: 34x20 (44x26 touch) pill. Off `--border-strong`, on
  ink, knob in the page colour.
- **Progress** `.meter` (`<ProgressBar>` / `<Meter>`): one 4px segment per planned item, ink when
  done, `--border` when not (`.bar`, a 3px line, above 12 items). Always next to "3 of 8" in words.
  No green, no accent.
- **Tabs** `.tabs`: text tabs on a hairline; the current one (`aria-current="page"`) is ink / 600
  with a 2px ink underline.
- **Month switcher** `.monthpick`: no box. Two ghost arrows (32px, 44px touch) around
  "November 2026" (`.m`) in 600.
- **View switch** (List / Board / Table, `<ViewToggle>`): quiet text buttons; the current one reads
  like the current sidebar row (`--surface-2`, ink, 600).
- **Figures** `.figure` inside `.figures` (`<Stat>` / `<Figure>`): `.eyebrow` label, the number in
  Newsreader 28px tabular (`.value`), a meta line. No box; figures are separated by 48px of space.
- **Things that float** `.pop`: `--surface`, a hairline, 6px radius (14px with `.is-sheet`),
  `--shadow-pop`.
- **Focus**: every focusable element gets `outline: 2px solid var(--text); outline-offset: 2px`.
  Inputs thicken their border instead.

## Shell

### Sidebar (desktop)

- 280px wide, page colour, 1px hairline on the right. Padding 26px top, 16px sides and bottom.
- Wordmark in Newsreader 22px. Under it the one primary button: "+ New ask", full width, label
  left, `N` key hint right.
- No icons. The nav is a table of contents: 32px rows (44px on touch), 14px text, 10px side
  padding, 6px radius. Current page: `--surface-2` fill and 600 weight, ink text (not accent).
- Counts (Inbox, Tasks) are right-aligned cinnabar numerals.
- Group headings (Grow, My businesses) are `.eyebrow`; groups are 22px apart.
- A business is one line: name left, city right in 12px muted. The city gives way first when space
  is short.
- Nora's row sits under a hairline, same row style (name left, @handle right).
- Foot: "Settings · Activity" as 13px muted text links, then a hairline, name left, "Sign out"
  right.

### Phone

- Top: a 48px row with the serif wordmark. No border, no blur, not sticky.
- Tab bar: Home · Inbox · + · Tasks · More. 64px plus the bottom safe area, solid page colour,
  hairline on top. No blur, no translucency. 24px line icons (stroke 1.6, 2 when current), 11px
  labels. Current tab is ink and 600 (not accent). Badges: 18px cinnabar pill with a 2px
  page-colour ring.
- "+" is a 48px cinnabar square with a 14px radius, no shadow. It is the only block of colour on a
  phone.
- More sheet: `--surface`, 14px top radius, `--shadow-pop`, 48px text rows on hairlines (name left,
  city or handle right), current row `--surface-2` and 600.
- Every tap target is 44px or taller; inputs are 16px so iOS does not zoom.
- `--tabbar-h` is the tab bar's height (0 on desktop): sticky bars sit above it with
  `bottom: calc(var(--tabbar-h) + 0.5rem)` (`.sticky-actions`).

## Component map

| Component (`src/components/ui.tsx`) | Draws |
|---|---|
| `PageHeader` (`title`, `subtitle`, `actions`, `crumb`) | `.page-head`: optional `.crumb`, `h1.display` with `.head-actions` on its baseline (`.head-row`), `.sub` under it |
| `Card` / `Section` (`title`, `actions`, `padded`, `className`) | `section.sec` with `.sec-head` (`h2.title` and the actions) and unboxed content. `padded={false}` is for lists. With no title: a hairline on top instead of the ink rule |
| `Status` (`tone`, `small`) | `.status` with the tone's dot |
| `Tag` (`bare`) | `.tag` |
| `Count` (`n`) | `.count` |
| `Badge` (`tone`) | With a tone: a small `Status`. Without: a `Tag`. Kept for old call sites; new code uses `Status` or `Tag` |
| `StatusBadge` (`status`) | A small `Status`; unknown and resting states get the hollow dot |
| `PlatformTag` (`platform`) | `.status.is-ig / .is-tt / .is-google / .is-facebook`, the name in the colour of its line |
| `buttonClass`, `Button`, `LinkButton` | `btn btn-primary / btn-secondary / btn-ghost / btn-danger`, plus `btn-sm` |
| `EmptyState` | `.empty` |
| `Stat` / `Figure` | `.figure` |
| `ProgressBar` / `Meter` | `.meter` up to 12 items, `.bar` above |

## What not to do

- No card boxes: no border plus fill plus radius around a group, no header divider, no inner
  padding box.
- No soft-coloured pills, and no `accent-soft` as a "selected" colour (sidebar, chips, tabs,
  sheets). Selected is ink.
- No icons in the sidebar, no bordered cards in the navigation.
- No decorative count tiles: a count lives in the sidebar and in its section title.
- No shadows except `--shadow-pop` on floating things. No blur, no translucency.
- No dashed empty-state boxes.
- No accent as a link or heading colour. No green or orange progress fills.
- No more than one primary (cinnabar) button on a screen.
- No money on Nora's schedule: there is no slot for an amount in a schedule row, a day group or the
  agenda.
- No webfont requests to a third party, and no second webfont.
- No em dashes in copy people read.
