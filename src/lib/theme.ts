/**
 * The page background of each palette (globals.css `--bg`), for the phone's browser and status bar
 * (`<meta name="theme-color">`). Keep these equal to `--bg` in globals.css.
 * A plain module (no "use client"), so the root layout and the Light / Dark choice both read the same values.
 */
export const THEME_BG = { light: "#fbfaf7", dark: "#131311" } as const;

/** Where the saved Light / Dark choice lives on this device (nothing saved = Auto). The root layout's script reads it
 * before the first paint and keeps the theme-color metas on the chosen palette. */
export const THEME_KEY = "nora-hq:theme";
