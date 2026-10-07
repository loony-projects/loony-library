import { createContext, useContext, useEffect, useState } from "react";
import { Check, Moon, Sun, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";

const STORAGE_KEY = "reading-settings";

// Reading fonts, all self-hosted (see index.css). `family` is applied to the
// reading text through --reading-font.
const FONTS = [
  { id: "newsreader", name: "Newsreader", note: "Serif", family: '"Newsreader Variable", Georgia, serif' },
  { id: "literata", name: "Literata", note: "Book serif", family: '"Literata Variable", Georgia, serif' },
  { id: "geist", name: "Geist", note: "Sans-serif", family: '"Geist Variable", ui-sans-serif, system-ui, sans-serif' },
  { id: "atkinson", name: "Atkinson Hyperlegible", note: "High legibility", family: '"Atkinson Hyperlegible Next Variable", ui-sans-serif, sans-serif' },
  { id: "opendyslexic", name: "OpenDyslexic", note: "Dyslexia-friendly", family: '"OpenDyslexic", ui-sans-serif, sans-serif' },
];

// Page colors: a background with its matching text color (each pair is at
// least 7:1 contrast, WCAG AAA). `dark` puts the rest of the UI - accents,
// highlights, code colors - into its dark theme to match.
const PALETTES = [
  { id: "paper", name: "Paper", bg: "#ffffff", fg: "#1f1f1f", dark: false },
  { id: "ivory", name: "Ivory", bg: "#fbf7ee", fg: "#2b2620", dark: false },
  { id: "sepia", name: "Sepia", bg: "#f4ecd8", fg: "#4a3a2a", dark: false },
  { id: "parchment", name: "Parchment", bg: "#ebdfc3", fg: "#3b2f1e", dark: false },
  { id: "mint", name: "Mint", bg: "#e7f3ec", fg: "#1d382a", dark: false },
  { id: "sky", name: "Sky", bg: "#e5eff9", fg: "#1a2c44", dark: false },
  { id: "rose", name: "Rose", bg: "#fbecee", fg: "#47222a", dark: false },
  { id: "lavender", name: "Lavender", bg: "#eeeaf7", fg: "#2c2444", dark: false },
  { id: "dusk", name: "Dusk", bg: "#2e3440", fg: "#e5e9f0", dark: true },
  { id: "midnight", name: "Midnight", bg: "#0f172a", fg: "#dde4ee", dark: true },
  { id: "forest", name: "Forest", bg: "#1b2a22", fg: "#d6e6da", dark: true },
  { id: "black", name: "Black", bg: "#000000", fg: "#d0d0d0", dark: true },
];

// The neutral design tokens a palette replaces. Surfaces, muted text and
// borders are mixed from the palette's two colors so the whole UI matches.
function paletteTokens({ bg, fg }) {
  const mix = (pct) => `color-mix(in oklab, ${fg} ${pct}%, ${bg})`;
  return {
    "--background": bg,
    "--foreground": fg,
    "--card": mix(3),
    "--popover": mix(3),
    "--secondary": mix(6),
    "--muted": mix(6),
    "--accent": mix(8),
    "--muted-foreground": mix(62),
    "--border": mix(14),
    "--input": mix(20),
  };
}

const findPalette = (id) => PALETTES.find((p) => p.id === id) ?? null;
const findFont = (id) => FONTS.find((f) => f.id === id) ?? FONTS[0];

function readSettings() {
  const prefersDark =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches;
  const defaults = { dark: prefersDark, size: 19, spacing: 1.7, font: FONTS[0].id, palette: null };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return defaults;
  }
}

const Context = createContext(null);
export const usePreferences = () => useContext(Context);

// Reading appearance persists per browser and applies app-wide: the theme
// on <html data-theme>, type size, leading and font as CSS variables, and a
// chosen page palette as inline overrides of the neutral color tokens.
export function PreferencesProvider({ children }) {
  const [settings, setSettings] = useState(readSettings);
  useEffect(() => {
    const root = document.documentElement;
    const palette = findPalette(settings.palette);
    root.dataset.theme = (palette ? palette.dark : settings.dark) ? "dark" : "light";
    for (const name of Object.keys(paletteTokens(PALETTES[0]))) root.style.removeProperty(name);
    if (palette) {
      for (const [name, value] of Object.entries(paletteTokens(palette))) {
        root.style.setProperty(name, value);
      }
    }
    root.style.setProperty("--reading-font", findFont(settings.font).family);
    root.style.setProperty("--reading-size", `${settings.size}px`);
    root.style.setProperty("--reading-spacing", settings.spacing);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);
  const update = (patch) => setSettings((s) => ({ ...s, ...patch }));
  return (
    <Context.Provider value={{ settings, update }}>{children}</Context.Provider>
  );
}

// Whether the page is currently dark - from the chosen palette if any.
const isDark = (settings) => findPalette(settings.palette)?.dark ?? settings.dark;

export function ThemeToggle() {
  const { settings, update } = usePreferences();
  const dark = isDark(settings);
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Tooltip content={label}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        // Light/dark switches back to the default page colors.
        onClick={() => update({ dark: !dark, palette: null })}
        className="text-muted-foreground hover:text-foreground"
      >
        {dark ? <Sun /> : <Moon />}
      </Button>
    </Tooltip>
  );
}

export function ReadingSettings() {
  const { settings, update } = usePreferences();
  return (
    <Popover>
      <Tooltip content="Reading appearance">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Reading appearance"
            className="text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          >
            <Type />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="w-76 p-5">
        <p className="mb-1 font-serif text-lg font-medium">Reading appearance</p>
        <p className="mb-5 text-[13px] text-muted-foreground">
          Saved on this device.
        </p>
        <div className="grid gap-6">
          <div className="flex items-center justify-between">
            <Label htmlFor="pref-dark">Dark mode</Label>
            <Switch
              id="pref-dark"
              checked={isDark(settings)}
              onCheckedChange={(dark) => update({ dark, palette: null })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pref-font">Font</Label>
            <Select value={findFont(settings.font).id} onValueChange={(font) => update({ font })}>
              <SelectTrigger id="pref-font" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONTS.map((font) => (
                  <SelectItem key={font.id} value={font.id}>
                    <span style={{ fontFamily: font.family }}>{font.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{font.note}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label id="pref-colors">Page color</Label>
              <button
                type="button"
                onClick={() => update({ palette: null })}
                disabled={!settings.palette}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-0"
              >
                Reset to default
              </button>
            </div>
            <div role="radiogroup" aria-labelledby="pref-colors" className="grid grid-cols-6 gap-2">
              {PALETTES.map((palette) => {
                const selected = settings.palette === palette.id;
                return (
                  <Tooltip key={palette.id} content={palette.name}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={palette.name}
                      onClick={() => update({ palette: palette.id })}
                      style={{ background: palette.bg, color: palette.fg }}
                      className={`relative grid aspect-square place-items-center rounded-md border border-border font-serif text-sm transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-popover" : ""}`}
                    >
                      {selected ? <Check className="size-4" aria-hidden /> : "Aa"}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label>Text size</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {settings.size}px
              </span>
            </div>
            <Slider
              aria-label="Text size"
              min={14}
              max={28}
              step={1}
              value={[settings.size]}
              onValueChange={([size]) => update({ size })}
            />
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label>Line spacing</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {settings.spacing.toFixed(1)}
              </span>
            </div>
            <Slider
              aria-label="Line spacing"
              min={1.2}
              max={2.4}
              step={0.1}
              value={[settings.spacing]}
              onValueChange={([spacing]) => update({ spacing })}
            />
          </div>
          <p
            className="rounded-md border border-border bg-background px-4 py-3 text-foreground"
            style={{
              fontFamily: findFont(settings.font).family,
              fontSize: `${Math.min(settings.size, 22)}px`,
              lineHeight: settings.spacing,
            }}
          >
            The quick brown fox jumps over the lazy dog.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
