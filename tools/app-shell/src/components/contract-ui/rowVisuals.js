/**
 * ETP-5600 — the shared row visuals of the Figma "Fila" components, used by both
 * row renderers: DataTable (list and classic tab grids, `<tr>` rows) and
 * InlineLinesPanel (document lines, flex `<div>` rows).
 *
 * Every value is a complete static class string so Tailwind's JIT finds it in this
 * file (`./src/**` is in the content globs). Never build one by concatenation.
 */

/** Figma Shadows/lg, applied on hover to a lifted row. */
export const ROW_LIFT_SHADOW = 'hover:shadow-[0_4px_6px_-2px_rgba(18,18,23,0.05),0_10px_15px_-3px_rgba(18,18,23,0.08)]';

/** The same Shadows/lg, unconditionally — for a row that stays lifted (a line being edited). */
export const ROW_LIFT_SHADOW_STATIC = 'shadow-[0_4px_6px_-2px_rgba(18,18,23,0.05),0_10px_15px_-3px_rgba(18,18,23,0.08)]';

/**
 * The borders of a lifted TABLE row on hover: its own `border-b` turns transparent (the
 * Shadows/lg falls over that edge), while the line ABOVE it — the previous row's `border-b`
 * in the collapsed-border grid — stays, so a hovered row keeps a single grey top line.
 * Resting rows keep their separators. Table rows only.
 *
 * History: ETP-5600 pass 1 redrew the top line as an inset cell shadow, which stacked on the
 * previous row's border into a double line that thinned out under the opaque quick-actions
 * band; QA pass 2 then hid both lines (`[&:has(+tr:hover)]:border-transparent`, the Figma
 * "Fila / State=Hover" frame). ETP-6209 (product decision) restores the top line by keeping
 * the previous row's own border, so there is exactly one 1px line and nothing to stack.
 */
export const ROW_LIFT_HOVER_BORDERS = 'hover:border-transparent';

/**
 * The composited `bg-muted/50` tint, for a row that tints on hover: a clickable row under
 * `hoverStyle="tint"`, or any non-clickable row (TableRow's own base `hover:bg-muted/50`).
 */
export const ROW_TINT_HOVER_BG = '[--row-hover-bg:color-mix(in_srgb,hsl(var(--muted))_50%,hsl(var(--card)))]';

/**
 * Whether a row raises on hover. `'tint'` is the only opt-out of the lift; `'elevated'`
 * (pre-ETP-5600 name) and anything else lift — only a clickable row, though. `'lift-always'`
 * (ETP-5526) lifts every row, for a grid whose rows have no click target of their own but
 * expose hover actions (the attachments table).
 */
export function rowLifts(hoverStyle, clickable) {
  if (hoverStyle === 'lift-always') return true;
  return Boolean(clickable) && hoverStyle !== 'tint';
}

/**
 * The hover / cursor / selection classes of one list row (Figma "Fila"), shared by every list:
 * DataTable's `getRowClassName` and the hand-built tables that must read like it (the customer
 * portal's document table, ETP-6209). Meant for a core `TableRow`, whose base classes
 * (`border-b border-border-subtle transition-colors hover:bg-muted/50`) it overrides through
 * `cn()`. The row height is the caller's.
 *
 * - `lift` (default): transparent at rest; on hover an opaque card background plus
 *   Shadows/lg, raised with `z-10`, instant (no colour transition), its own bottom line hidden
 *   and the line above kept ({@link ROW_LIFT_HOVER_BORDERS}).
 * - `tint`: the translucent `bg-muted/50` wash.
 * - `lift-always`: the lift on every row, clickable or not.
 *
 * A selection colour (`selectionClass`) always wins over the hover background; a lifted row
 * still gets the shadow. `selectedLine` (an inline-lines focused row) never lifts. Every row
 * sets `--row-hover-bg` to its hovered background for the quick-actions fade.
 *
 * @param {{ clickable?: boolean, hoverStyle?: string, selectionClass?: string,
 *   selectedLine?: boolean }} [options]
 * @returns {string}
 */
export function listRowClassName({
  clickable = false, hoverStyle = 'lift', selectionClass = '', selectedLine = false,
} = {}) {
  const liftRow = rowLifts(hoverStyle, clickable);
  let hoverClass = '';
  if (liftRow && !selectedLine) {
    hoverClass = [
      'hover:z-10', ROW_LIFT_SHADOW, ROW_LIFT_HOVER_BORDERS,
      selectionClass ? '' : 'hover:bg-card [--row-hover-bg:hsl(var(--card))]',
    ].filter(Boolean).join(' ');
  } else if (!selectedLine && !selectionClass) {
    // A non-clickable row still tints through TableRow's base `hover:bg-muted/50`, so it only
    // needs the matching `--row-hover-bg` for the quick-actions fade to end on it.
    hoverClass = clickable ? `hover:bg-muted/50 ${ROW_TINT_HOVER_BG}` : ROW_TINT_HOVER_BG;
  }
  return [
    'group/row',
    liftRow ? 'relative transition-none' : 'transition-colors',
    clickable ? 'cursor-pointer' : 'cursor-default',
    selectionClass,
    hoverClass,
  ].filter(Boolean).join(' ');
}

/**
 * Minimum width (px) of the list "Sticky Acciones" band. ETP-5600 (review W1): it is a
 * LAYOUT floor, not a visual one — DataTable reserves at least this much for the
 * canonical quick-actions column (`quickActionsReservedWidthPx`), and the band is
 * exactly its cell (`min-w-full`), so with 1–2 buttons the band never reaches past its
 * cell into the last data column.
 */
export const QUICK_ACTIONS_MIN_BAND_PX = 100;

/**
 * Figma "Sticky Acciones" (Fila Contactos / State=Hover): the hover band that holds a
 * list row's quick actions, pinned to the right of its cell. As wide as its cell, which
 * DataTable reserves at no less than `QUICK_ACTIONS_MIN_BAND_PX` (100px), so it masks the
 * whole reserved column while the cell floats over data and never overflows it; padding 0 12px, buttons flush right with a 2px gap (four buttons
 * make the Figma 158px band: 4 x 32 + 3 x 2 + 24 — the width follows the buttons a
 * window actually shows, never a fixed 158px that would mask more data than needed); background the
 * Figma gradient from transparent to the row's hovered colour at 10.58%
 * (`--row-hover-bg`, set per row state by DataTable) — no border, no shadow. Hidden at
 * rest, shown on row hover, keyboard focus, or while its kebab menu is open.
 */
export const ROW_STICKY_ACTIONS = 'absolute right-0 inset-y-0 h-full min-w-full flex flex-row items-center justify-end gap-0.5 px-3 z-10 bg-[linear-gradient(90deg,rgba(255,255,255,0)_0%,var(--row-hover-bg,hsl(var(--card)))_10.58%)] opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100';

/**
 * The same "Sticky Acciones" band for a document line (`InlineLinesPanel`), whose rows
 * are flex `<div>`s that scroll horizontally inside the lines body box (ETP-5600 QA
 * pass 2). Two layers, because a line has no `<td>` to pin:
 *
 * - `LINE_STICKY_ACTIONS_SLOT` — the line's reserved action slot (`ACTION_SLOT_WIDTH_PX`,
 *   in flow, so it never covers the last column when scrolled to the end), made
 *   `sticky right-0` while its actions show, so with horizontal overflow it stays on
 *   the VISIBLE right edge of the scroll box instead of being cut off past it. It
 *   paints nothing itself and is click-through: the data under its empty left part
 *   stays visible and clickable.
 * - `LINE_STICKY_ACTIONS_BAND` — the buttons' band inside it: buttons flush right,
 *   padding 0 12px, at least 100px wide (inside its own 158px slot), the very gradient of `ROW_STICKY_ACTIONS`
 *   (ending on the line's `--row-hover-bg`), so a column it floats over fades out
 *   behind an opaque background instead of showing through the icons. 2px gap, as the
 *   list band, so four buttons are exactly the Figma 158px band and fill the 158px
 *   `ACTION_SLOT_WIDTH_PX` slot.
 */
export const LINE_STICKY_ACTIONS_SLOT = 'sticky right-0 z-10 flex items-stretch justify-end pointer-events-none';
export const LINE_STICKY_ACTIONS_BAND = 'pointer-events-auto flex items-center justify-end gap-0.5 min-w-[100px] px-3 bg-[linear-gradient(90deg,rgba(255,255,255,0)_0%,var(--row-hover-bg,hsl(var(--card)))_10.58%)]';

/**
 * Figma "Fila / Selected": #F5F7F9 (`--field-hover`, the exact design value). Hover
 * keeps it (selection wins over hover), and `--row-hover-bg` lets DataTable's
 * quick-actions fade end on it.
 */
export const ROW_CHECKED_BG = 'bg-[hsl(var(--field-hover))] hover:bg-[hsl(var(--field-hover))] [--row-hover-bg:hsl(var(--field-hover))]';

/**
 * Figma Icon Button sm (32x32), Round, Tertiary, 20px icon, 200ms ease-in — the hover
 * action buttons of a row, shared by the list quick actions (`RowQuickActions`) and the
 * document-line action strip (`InlineLinesPanel`). No fill at rest (the white pill stays
 * off, `QUICK_ACTIONS_USE_PILL`). Size the icon inside with `h-5 w-5`.
 *
 * Neutral (edit, duplicate, email, kebab, extra line actions): #828FA3 icon in every
 * state — the exact Figma `icon/outline/secondary` token `--sf-icon-outline-secondary`
 * (index.css; lighter in dark mode), hover adds the #121217 @ 5% overlay; focus-visible paints a white fill with the
 * two-ring halo (2px white gap + 4px #121217).
 */
export const ROW_ACTION_BUTTON_NEUTRAL = 'h-8 w-8 p-0 flex items-center justify-center rounded-full transition-colors duration-200 ease-in focus-visible:outline-none focus-visible:bg-card text-[hsl(var(--sf-icon-outline-secondary))] hover:bg-[rgba(18,18,23,0.05)] focus-visible:shadow-[0_0_0_2px_#FFFFFF,0_0_0_4px_#121217]';

/**
 * Destructive (delete): #D50B3E icon (`--status-destructive-fg`, pair it with
 * `TrashIcon`), hover to the light destructive tint (`--status-destructive-bg`,
 * #FEF0F4) — never a solid red fill; focus-visible halo uses #F53D6B.
 */
export const ROW_ACTION_BUTTON_DESTRUCTIVE = 'h-8 w-8 p-0 flex items-center justify-center rounded-full transition-colors duration-200 ease-in focus-visible:outline-none focus-visible:bg-card text-[var(--status-destructive-fg)] hover:bg-[var(--status-destructive-bg)] focus-visible:shadow-[0_0_0_2px_#FFFFFF,0_0_0_4px_#F53D6B]';

/**
 * Active cue for a neutral row action whose state is "on" (the edit button of the line
 * being edited): the hover overlay, kept at rest.
 */
export const ROW_ACTION_BUTTON_ACTIVE = 'bg-[rgba(18,18,23,0.05)]';
