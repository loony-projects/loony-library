import { createContext, useContext, useEffect, useState } from "react";
import { Loader2, LogOut, UserRound } from "lucide-react";
import { api } from "../api";
import { initials } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const Context = createContext({});
export const useAccount = () => useContext(Context);
export function AccountProvider({ children }) {
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(false);
  useEffect(() => {
    api
      .get("/api/auth/me")
      .then((d) => setUser(d.user))
      .finally(() => setReady(true))
      .catch(() => {});
  }, []);
  return (
    <Context.Provider
      value={{ user, setUser, ready, editor: user?.role === "editor" }}
    >
      {children}
    </Context.Provider>
  );
}

function AuthDialog({ open, onOpenChange }) {
  const { setUser } = useAccount();
  const [mode, setMode] = useState("login"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await api.post(
        `/api/auth/${mode}`,
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      setUser(d.user);
      onOpenChange(false);
      window.location.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const login = mode === "login";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[26rem]">
        <DialogHeader>
          <DialogTitle>{login ? "Welcome back" : "Create your account"}</DialogTitle>
          <DialogDescription>
            {login
              ? "Sign in to pick up where you left off."
              : "Keep your place, shelves and notes across devices."}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          {!login && (
            <Field label="Name" htmlFor="auth-name">
              <Input id="auth-name" name="name" required maxLength={100} autoComplete="name" />
            </Field>
          )}
          <Field label="Email" htmlFor="auth-email">
            <Input id="auth-email" name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Password" htmlFor="auth-password" hint="Use at least 12 characters.">
            <Input
              id="auth-password"
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={256}
              autoComplete={login ? "current-password" : "new-password"}
            />
          </Field>
          {error && (
            <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy} className="mt-1 w-full">
            {busy && <Loader2 className="animate-spin" />}
            {busy ? "Working…" : login ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          {login ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => {
              setMode(login ? "register" : "login");
              setError("");
            }}
          >
            {login ? "Create an account" : "Sign in instead"}
          </button>
        </p>
      </DialogContent>
    </Dialog>
  );
}

// Navbar account control: a sign-in button, or the signed-in user's menu.
export default function AccountMenu() {
  const { user, setUser, ready } = useAccount();
  const [open, setOpen] = useState(false);
  if (!ready) return <div className="size-9" aria-hidden />;
  if (!user)
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Sign in
        </Button>
        <AuthDialog open={open} onOpenChange={setOpen} />
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
        <DropdownMenuItem
          onSelect={async () => {
            await api.post("/api/auth/logout", {});
            setUser(null);
            window.location.reload();
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
