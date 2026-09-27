import { createContext, useContext, useEffect, useState } from "react";
import { Moon, Sun, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";

const STORAGE_KEY = "reading-settings";

function readSettings() {
  const prefersDark =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches;
  const defaults = { dark: prefersDark, size: 19, spacing: 1.7 };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return defaults;
  }
}

const Context = createContext(null);
export const usePreferences = () => useContext(Context);

// Reading appearance persists per browser and applies app-wide: the theme
// on <html data-theme>, type size and leading as CSS variables.
export function PreferencesProvider({ children }) {
  const [settings, setSettings] = useState(readSettings);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.dark ? "dark" : "light";
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

export function ThemeToggle() {
  const { settings, update } = usePreferences();
  const label = settings.dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Tooltip content={label}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        onClick={() => update({ dark: !settings.dark })}
        className="text-muted-foreground hover:text-foreground"
      >
        {settings.dark ? <Sun /> : <Moon />}
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
              checked={settings.dark}
              onCheckedChange={(dark) => update({ dark })}
            />
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
            className="rounded-md bg-muted px-4 py-3 font-serif text-foreground"
            style={{
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
