/**
 * The app list toolbar's quick-filter button look, shared by `ListFilterBar` (status, type and
 * date selectors) and the customer portal's list toolbar (ETP-6209), so both read the same.
 * A complete static class string, so Tailwind's JIT finds it in this file.
 */

// ETP-5601 — Figma's toolbar type: text-sm/leading-6/font-medium in #121217 for every text
// control, idle or active. An active filter is told apart by its border alone. `text-[#121217]`
// already has a dark-mode remap in the core stylesheet. Icons are 20px in
// #828FA3; `[&_svg]:` is needed because the core Button forces `[&_svg]:size-4` on its children.
// The chevron is the exception: `!size-4` (16px box, ~8px glyph as in Figma) must beat the
// parent `[&_svg]:size-5` selector, which outranks a plain class on the icon itself.
export const TOOLBAR_SELECT_CLASS = 'gap-1.5 text-sm leading-6 font-medium text-[#121217] h-10 px-3 rounded-lg bg-card data-[state=open]:border-[hsl(var(--foreground))] [&_svg]:size-5 [&_svg]:text-[#828FA3]';
