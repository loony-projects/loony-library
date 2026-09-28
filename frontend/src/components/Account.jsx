import { createContext, useContext, useEffect, useState } from "react";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { api, API_URL } from "../api";
import { initials } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const Context = createContext({});
export const useAccount = () => useContext(Context);
export function AccountProvider({ children }) {
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(false),
    // The backend's OAuth callback redirects here with ?auth_error=... when
    // sign-in with loony-auth didn't complete.
    [authError] = useState(() =>
      new URL(window.location.href).searchParams.has("auth_error"),
    );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("auth_error")) {
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url);
    }
    api
      .get("/api/auth/me")
      .then((d) => setUser(d.user))
      .finally(() => setReady(true))
      .catch(() => {});
  }, []);
  return (
    <Context.Provider
      value={{ user, setUser, ready, authError, editor: user?.role === "editor" }}
    >
      {children}
    </Context.Provider>
  );
}

// Navbar account control: a sign-in button, or the signed-in user's menu.
export default function AccountMenu() {
  const { user, setUser, ready, authError } = useAccount();
  if (!ready) return <div className="size-9" aria-hidden />;
  // Sign-in happens on loony-auth's hosted page: a full-page navigation to
  // the backend, which redirects there and back.
  if (!user)
    return (
      <>
        {authError && (
          <span role="alert" className="text-sm text-destructive">
            Sign-in failed
          </span>
        )}
        <Button size="sm" variant="outline" asChild>
          <a href={`${API_URL}/api/auth/login`}>Sign in</a>
        </Button>
      </>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="ml-1 flex size-9 items-center justify-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary-soft-foreground ring-offset-2 ring-offset-background transition-shadow outline-none hover:ring-2 hover:ring-border focus-visible:ring-[3px] focus-visible:ring-ring"
          aria-label="Account menu"
        >
          {initials(user.name) || <UserRound className="size-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-[13px] text-muted-foreground">{user.email}</p>
          <Badge variant={user.role === "editor" ? "default" : "secondary"} className="mt-2 capitalize">
            {user.role}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={`${API_URL}/api/auth/account`}>
            <ShieldCheck />
            Account security
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            const d = await api.post("/api/auth/logout", {});
            setUser(null);
            // Also sign out of loony-auth, which then sends the browser back.
            if (d?.logoutUrl) window.location.assign(d.logoutUrl);
            else window.location.reload();
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
