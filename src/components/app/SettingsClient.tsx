"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { Button, Input, Label, Notice } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";

export function PasswordForm() {
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return toast("Use at least 10 characters.", "error");
    if (pw !== pw2) return toast("Passwords don't match.", "error");
    const sb = getSupabaseBrowser();
    if (!sb) return toast("Authentication is not configured.", "error");
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast(error.message, "error");
    setPw("");
    setPw2("");
    toast("Password updated", "success");
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="h-4 w-4 text-subtle" /> Change password
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pw">New password</Label>
          <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={10} required />
        </div>
        <div>
          <Label htmlFor="pw2">Confirm</Label>
          <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={10} required />
        </div>
      </div>
      <Button type="submit" size="sm" loading={busy}>
        Update password
      </Button>
    </form>
  );
}

export function PrivacyControls({ demo }: { demo: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"history" | "account" | null>(null);

  async function clearHistory() {
    setBusy("history");
    try {
      await api("/api/account", { method: "DELETE", json: { scope: "history" } });
      toast("Search history cleared", "success");
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setBusy("account");
    try {
      await api("/api/account", { method: "DELETE", json: { scope: "account", confirm } });
      router.push("/");
      router.refresh();
    } catch (e) {
      toast((e as ApiError).message, "error");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-subtle" /> Search history
        </div>
        <p className="text-sm text-muted">Your searches are stored in your private history (visible only to you) so you can revisit them. Saved searches, projects and alerts are kept when you clear history.</p>
        <Button size="sm" variant="secondary" onClick={clearHistory} loading={busy === "history"} disabled={demo}>
          Clear search history
        </Button>
      </div>
      <div className="space-y-2 rounded-xl border border-rose/30 bg-rose-soft/40 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-rose">
          <Trash2 className="h-4 w-4" /> Delete account
        </div>
        <p className="text-sm text-muted">
          {demo
            ? "Leaves the demo workspace and clears its plan cookie."
            : "Cancels any subscription immediately (no further charges) and permanently deletes your projects, alerts, saved searches, identity corrections and history."}
        </p>
        {demo ? (
          <Button size="sm" variant="secondary" onClick={deleteAccount} loading={busy === "account"}>
            Leave demo workspace
          </Button>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="confirm">Type DELETE to confirm</Label>
              <Input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-9 w-40" />
            </div>
            <Button size="sm" onClick={deleteAccount} loading={busy === "account"} disabled={confirm !== "DELETE"} className="bg-rose text-white hover:bg-rose/90">
              Delete my account
            </Button>
          </div>
        )}
      </div>
      {demo ? <Notice tone="amber">Demo workspace data lives in server memory and resets when the server restarts.</Notice> : null}
    </div>
  );
}
