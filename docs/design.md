# Nora HQ design system: "Ink"

Paper, ink, one seal. The page is paper-white, the text is near-black, and structure comes from
hairlines and whitespace instead of boxes. A serif (Newsreader) sets the titles; the device's own
UI font sets everything else. Colour appears in three places only: the one cinnabar action on a
screen, the counts that are waiting on you, and a 7px status dot.

The product rule behind it: simplicity is the ultimate sophistication, less is more. It has to work
as well on a phone as on a desktop, in light and in dark.

## Where things live

| What | Where |
|---|---|
| Tokens (colour, type, space, shape), base rules, shared classes, the shell | `src/app/globals.css` |
| Classes for one area of the app | `src/app/styles/<area>.css` (`home-inbox`, `business`, `calendar-tasks`, `grow`, `public-settings`) |
| Shared components | `src/components/ui.tsx` (and `client-form.tsx`, `view-toggle.tsx`, `phone-disclosure.tsx`, `copy-button.tsx`, `upload-picker.tsx`, `month-picker.tsx`, `onboard-link.tsx`, `live-refresh.tsx`) |
| Shell: sidebar, phone top row, tab bar, More sheet, the Appearance choice | `src/components/sidebar.tsx`, `src/components/section-tabs.tsx`, `src/components/theme-choice.tsx`, `src/app/(app)/layout.tsx` |
| The display font | `@fontsource-variable/newsreader/opsz.css`, imported in `src/app/layout.tsx` (self-hosted, no font requests to a third party) |

Cascade layers, lowest to highest: `theme`, `base`, `components` (the shared classes), `pages`
(the per-area stylesheets), `utilities` (Tailwind). So an area class refines a shared class, and a
Tailwind utility on the same element still wins over both. A few rules are unlayered on purpose and
beat everything: the focus ring, the selection colour, 16px inputs on touch, the focus clearance
(`scroll-padding`) and the `.sticky-actions` position.

## Colour

All values are tokens in `globals.css` (light and dark). Use them as `var(--token)` or through the
Tailwind aliases (`bg-surface`, `text-muted`, `border-border-strong`, `text-faint`, ...).

Day and night (Auto / Light / Dark): the light palette is the default. The dark palette applies
when the device is dark and nothing was picked ("Auto"), or always once the person picks Dark; Light
keeps the light palette on a dark device. The choice is `<ThemeChoice>` (the sidebar foot, and
"Appearance" in the phone More sheet). It sets `data-theme` on `<html>` and saves it on the device;
the tiny script in `src/app/layout.tsx` puts it back before the first paint. In CSS the dark tokens
are written twice, under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`
and under `:root[data-theme="dark"]`: keep the two blocks equal. Tailwind's `dark:` variant follows
the same choice. Never test `prefers-color-scheme` on its own in a page stylesheet; use the tokens
(or `dark:`), so a picked theme always wins.

- `--bg` is paper. `--surface` is only for things that sit above the page: inputs, checkboxes,
  sheets, menus. Sections have no background.
- `--text` is ink. `--muted` is secondary text (passes AA on `--bg`, `--surface` and `--surface-2`).
- `--border` is the hairline between rows. `--border-strong` outlines inputs, checkboxes and
  secondary buttons at 3:1. `--faint` is for chevrons and other glyphs, never for words.
- `--accent` is cinnabar: the one accent action on a screen (in the app that is "New ask" in the
  sidebar and the "+" on a phone), counts that need you (as plain coloured numerals), today's date
  numeral. Nothing else: not a heading, a link, a selected state or a post state. Links are ink with
  a thin underline.
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
| Eyebrow (group labels, table heads) | `.eyebrow` | sans, caps | 12 / 16 | 12 / 16 | 600, `--muted` | 0.07em |
| Count that needs you | `.count` | sans, tabular | 13 | 14 | 600, `--accent` | 0 |
| Sidebar link | | sans | 14 / 22 | | 400, 600 when current | 0 |
| Tab bar label | | sans | | 12 / 14 | 500, 600 when current | 0 |
| Agenda day numeral, a figure | `.serif` + a size | Newsreader | 24 to 28 | same | 450 | -0.01em |
| Wordmark "Nora HQ" | `.wordmark` | Newsreader | 22 | 19 | 500 | -0.01em |

- Body text takes no size class: it inherits 15 / 22 (16 / 24 on phones) from `body`.
- Tailwind's `text-xs`, `text-sm` and `text-base` are the same tokens (`--text-xs`, `--text-sm`,
  `--text-base`): 12, 13 and 15px on desktop, 12, 14 and 16px on phones. So `text-sm` is meta size,
  not body size, and `text-xs` is for caps labels only.
- Nothing is smaller than 12px, on any screen: no `text-[10px]` / `text-[11px]`, no 11px chart
  labels (SVG `fontSize={12}` or more), no 0.6875rem.
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
  last. A list with no title of its own adds `.is-ruled` for a hairline top and bottom.
- A row is `.row`: baseline-aligned flex or grid, 44 / 48px tall. Wide: one line, with fixed
  right-hand columns so lists line up (business 168px, when 76px, chevron 14px, 16px gaps). Narrow
  (under 1024px): two lines, the title and then one `.row-meta` line whose facts are joined by "·".
- Group labels inside a list (schedule days) are `.eyebrow` with a hairline under them; "Today" is
  the same label in ink (600), right-aligned; the schedule's one red letter is today's numeral in the
  month grid.
- Hover on a row underlines its title. No hover fills inside lists.
- A warning or a note that used to be a soft-coloured box is `.notice`: one row between two
  hairlines, a `.status.is-warn` and then the action as an ink `.link`.
- An empty list is `.empty`: a 500 ink line and a muted 13px line, left-aligned, no box.

## Controls

- **Buttons** `.btn`: 36px (44px touch), 6px radius, 14px sides, 14px / 500 label (16px on phones).
  **One accent action per screen.** Inside the app that one is the sidebar's "New ask" (the phone
  "+"), so a page never adds a second cinnabar button. `variant="primary"` is the screen's one focal
  action: on the pages without the app shell (sign in, the owner form, /collab, /drop, /kit) and in a
  dialog it is cinnabar; inside the app shell (`.shell-main`) globals.css draws it in ink (ink fill,
  paper label, like a selected chip), so a leftover primary can never be a second cinnabar. Use it
  at most once per screen and only for what the screen is for (Approve on the review card in focus,
  Download PDF, Send); everything else, saves included, is `.btn-secondary` (the default of
  `<Button>`, `<LinkButton>` and `<SubmitButton>`) or `.btn-ghost`. `variant="ink"` (`.btn-ink`) is
  the same ink fill anywhere. Never `bg-accent` on a control. Page-head actions are `size="sm"`; a
  button beside a 36px input or ending a form is `md`.
  `.btn-secondary` 1px `--border-strong`
  outline, ink label; hover darkens the outline. `.btn-ghost` no outline, muted label; hover
  `--surface-2`. `.btn-danger` outline with `--danger` label. `.btn-sm` 28px with a mouse, 44px on
  touch. Use `buttonClass(variant, size)`, `<Button>` or `<LinkButton>`.
- **Chips** (filters) `.chip` inside `.chips`: pill, 1px `--border-strong`, 13px / 500, count in
  muted tabular figures (`<i>`). Selected (`aria-pressed="true"` on a button, `aria-current` on a
  link): ink fill, paper text. The button is 44px tall on touch; the pill drawn inside is 34px.
  Markup: `<button class="chip" aria-pressed="true"><span>All <i>37</i></span></button>`.
- **Tags** `.tag` (`<Tag>`): a fact about a row (Free, Creator, From Oct). 20px tall, 4px radius,
  hairline outline, 12px / 600 caps, muted (plain, untracked 12px under `:lang(zh)`). Never coloured.
- **Status** `.status.is-ok|is-warn|is-danger|is-info|is-idle|is-accent|is-ink` (`<Status tone>`): a 7px
  dot and plain words. Words are ink, except `is-ok` and `is-idle` which are muted (nothing to do).
  `is-idle` is a hollow dot. No state uses `is-accent` (new asks and collab requests are `is-info`, a hot lead
  stage is `is-warn`, "Claude is on it" is `is-ink`). `is-ink` is a solid ink dot for a settled state that is neither good
  news nor a warning (a post that is "Ready"), so it is never confused with `is-danger`. This replaces every soft-coloured pill. Platforms are the same thing:
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
  with a 2px ink underline. 44px tall and at least 44px wide on touch. A tab strip that scrolls sideways
  (`.tabs.overflow-x-auto`, `.board-tabs`) keeps each tab at its full width. Section tabs (sibling pages under one
  sidebar entry: Inbox, Outreach, Insights) sit above the page title, drawn by the layout; a page's own view tabs
  (Schedule / Posts, the task scopes) sit under its title and subtitle.
- **Segmented choice** `.seg` (`<ThemeChoice>`: Auto / Light / Dark): quiet text buttons in a row;
  the chosen one (`aria-checked`, `aria-pressed` or `aria-current`) reads like the current sidebar row.
- **Month switcher** `.monthpick`: no box. Two ghost arrows (32px, 44px touch) around
  "November 2026" (`.m`) in 600.
- **View switch** (List / Board / Table, `<ViewToggle>`): quiet text buttons; the current one reads
  like the current sidebar row (`--surface-2`, ink, 600). On a phone only the icons show (44px squares; the labels
  stay for screen readers), so the page head keeps to one row.
- **Figures** `.figure` inside `.figures` (`<Stat>` / `<Figure>`): `.eyebrow` label, the number in
  Newsreader 28px tabular (`.value`), a meta line. No box; figures are separated by 48px of space.
  On a phone they are two columns whose labels, numbers and meta lines share rows (subgrid), so a
  label that wraps never pushes its number below its neighbour's. An empty value is "—" (a mark, not copy).
- **Things that float** `.pop`: `--surface`, a hairline, 6px radius (14px with `.is-sheet`),
  `--shadow-pop`.
- **A bar that stays in reach** `.action-bar` (Save, Send, Download PDF, the review queue's
  Approve): a solid paper strip with a hairline on top, no blur, no shadow, no rounded box. Sticky
  ones live inside `.sticky-actions` (flush on the tab bar, `bottom: var(--tabbar-h)`); fixed ones
  sit at `bottom-[var(--tabbar-h)]`.
- **Focus**: every focusable element gets `outline: 2px solid var(--text); outline-offset: 2px`.
  Inputs thicken their border instead. Inside a sideways scroller (`.overflow-x-auto`, a tab or chip
  strip) the ring is drawn inside the control (offset -2px) so the strip cannot clip it.
- **Focus clearance**: focus must never land under the phone tab bar or a bar that stays in reach.
  `html` has `scroll-padding-bottom: calc(var(--tabbar-h) + 0.75rem)`, raised to `+ 5.5rem` while the
  page has a `.sticky-actions`, `.action-bar`, `.queue-bar` or `.ask-bar`, or an element pinned with
  `bottom-[var(--tabbar-h)]` / `bottom-[calc(var(--tabbar-h)...)]`. So: give a new bar one of those
  classes, keep it under 5.5rem tall, and sheets keep `scroll-padding-block: 8px` on `.sheet-panel`. The two phone
  bars that are taller have their own rule next to it in `globals.css`: the send mode bar (`.queue-bar.send-bar`,
  +7.75rem) and the bulk-select panel on /tasks (`.bulk-bar`, +12rem).

## Shell

### Sidebar (desktop)

- 280px wide, page colour, 1px hairline on the right. Padding 26px top, 16px sides and bottom.
- Wordmark in Newsreader 22px. Under it the one primary button: "+ New ask", full width, label
  left, `N` key hint right.
- No icons. The nav is a table of contents: 32px rows (44px on touch), 14px text, 10px side
  padding, 6px radius. Current page: `--surface-2` fill and 600 weight, ink text (not accent).
- Counts (Inbox, Tasks, Calendar's reels to post) are right-aligned cinnabar numerals.
- Group headings (Grow, or Mine for Nora; My businesses, which Nora does not see) are `.eyebrow`;
  groups are 22px apart. Nora's HQ is a notes-and-reminders app: Home, Calendar, Files, then Mine
  (Notes, Contracts). Her primary button is "+ New note". Cameron's Grow group ends with "Files for
  Nora", where he sends her files.
- A business is one line: name left, city right in 12px muted. The city gives way first when space
  is short.
- Nora's workspace row sits under a hairline, same row style (name left, @handle right). Cameron
  only: Nora's own nav does not list it.
- Foot: "Settings · Activity" as 13px muted text links (Nora: Settings), the Appearance choice
  (Auto / Light / Dark, `.seg`), then a hairline, name left, "Sign out" right.

### Phone

- Top: a 48px row with the serif wordmark. No border, no blur, not sticky.
- Tab bar: Home · Inbox · + · Tasks · More for Cameron (Calendar is in More), Home · Calendar · + ·
  Files · More for Nora (Notes and Contracts are in More; her "+" opens a new note or reminder, and
  the Files badge counts files she has not opened). 64px plus the bottom safe area, solid page colour,
  hairline on top. No blur, no translucency. 24px line icons (stroke 1.6, 2 when current), 12px
  labels. Current tab is ink and 600 (not accent). Badges: 18px cinnabar pill with a 2px
  page-colour ring.
- "+" is a 48px cinnabar square with a 14px radius, no shadow. It is the only block of colour on a
  phone.
- More sheet: `--surface`, 14px top radius, `--shadow-pop`, 48px text rows on hairlines (name left,
  city or handle right), current row `--surface-2` and 600. "Appearance" (Auto / Light / Dark) sits
  above the name and Sign out.
- Every tap target is 44px or taller; inputs are 16px so iOS does not zoom.
- `--tabbar-h` is the tab bar's height (0 on desktop): a sticky action bar (`.sticky-actions` with an
  `.action-bar` inside) is a solid paper strip with a hairline on top, flush with the top of the tab
  bar (`bottom: var(--tabbar-h)`), so nothing shows underneath it. See Focus clearance.
- A native `<dialog className="sheet">` is a bottom sheet on phones; its box reset lives in `@layer base`,
  so `md:m-auto md:max-w-md` on the call site centres it on desktop without `!`.

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
| `buttonClass`, `Button`, `LinkButton` (`variant`, `size`) | `btn btn-primary / btn-secondary / btn-ghost / btn-danger / btn-ink`, plus `btn-sm`. `primary` is ink inside the app shell, cinnabar outside it and in dialogs |
| `SubmitButton`, `ConfirmButton`, `ActionForm` (`client-form.tsx`) | Buttons as above (SubmitButton defaults to `secondary`); the form's message is a small `Status` (ok / danger dot) |
| `ThemeChoice` (`theme-choice.tsx`) | `.seg` radio group: Auto / Light / Dark |
| `MonthPicker` (`month-picker.tsx`) | `.monthpick-wrap` > `.monthpick` (arrows, `.m` with the month input laid over it) and "Back to this month" |
| `ViewToggle` | ghost `btn-sm` links, the current one `--surface-2` / ink / 600 |
| `NewClientLink` (`onboard-link.tsx`) | `button`: a secondary button; `plus`: `.side-add`; `row`: a `.more-row` |
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
- No more than one cinnabar action on a screen (in the app: "New ask" / the phone "+", nothing
  else), and no more than one ink-filled focal button either. No `bg-accent` on a page.
- No text under 12px, no tap target under 44px on touch, no input under 16px on a phone, no sideways
  scroll at 390 or 320, no focus hidden under the tab bar or a bar that stays in reach.
- No duplicate content: one list per thing on a page (no second list of the same businesses, no
  plan shown twice, no filter chip that repeats a section tab). On Home, a business's health (a dot
  and its single worst issue, or "All good") is a line in its row of the Businesses ledger.
- No money on Nora's schedule: there is no slot for an amount in a schedule row, a day group or the
  agenda.
- No webfont requests to a third party, and no second webfont.
- No em dashes in copy people read.
