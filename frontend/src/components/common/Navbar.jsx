import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import AccountMenu from "../Account";
import { ReadingSettings, ThemeToggle } from "../Preferences";
import Logo from "./Logo";

// Sticky, translucent header that gains a hairline once the page scrolls.
export default function Navbar({ children, actions, className }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      className={cn(
        "no-print sticky top-0 z-40 border-b border-transparent bg-background/80 backdrop-blur-md backdrop-saturate-150 transition-[border-color,box-shadow] duration-200",
        scrolled && "border-border/70 shadow-[0_1px_0_0_transparent]",
        className,
      )}
    >
      <div className="mx-auto flex h-16 max-w-[88rem] items-center gap-4 px-4 sm:px-6 lg:px-10">
        <Logo />
        <div className="flex min-w-0 flex-1 items-center justify-center">{children}</div>
        <div className="flex items-center gap-1">
          {actions}
          <ReadingSettings />
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
