"use client";

import { useState } from "react";
import type { PlanId } from "@/lib/config/plans";
import { api, ApiError, track } from "@/lib/client/api";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";

/** Starts Stripe Checkout for a plan (server creates the session; the browser only gets the URL). */
export function CheckoutButton({ plan, label, variant = "primary", returnTo, signedIn, className }: { plan: Exclude<PlanId, "free">; label: string; variant?: "primary" | "secondary"; returnTo?: string; signedIn: boolean; className?: string }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  async function go() {
    if (!signedIn) {
      track("signup_started", { plan });
      location.href = `/signup?plan=${plan}&next=${encodeURIComponent(returnTo ?? "/app/billing")}`;
      return;
    }
    setLoading(true);
    try {
      const { url } = await api<{ url: string }>("/api/stripe/checkout", { method: "POST", json: { plan, returnTo: returnTo ?? null } });
      location.href = url;
    } catch (e) {
      toast((e as ApiError).message, "error");
      setLoading(false);
    }
  }
  return (
    <Button onClick={go} loading={loading} variant={variant} className={className}>
      {label}
    </Button>
  );
}

export function PortalButton({ label = "Manage billing", className }: { label?: string; className?: string }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  async function go() {
    setLoading(true);
    try {
      const { url } = await api<{ url: string }>("/api/stripe/portal", { method: "POST" });
      location.href = url;
    } catch (e) {
      toast((e as ApiError).message, "error");
      setLoading(false);
    }
  }
  return (
    <Button onClick={go} loading={loading} variant="secondary" className={className}>
      {label}
    </Button>
  );
}
