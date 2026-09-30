import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Every third-party credential is read here and nowhere else,
 * so nothing secret can leak into client bundles (this module is `server-only`).
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NEXT_PUBLIC_SITE_URL: z.string().default("http://localhost:3000"),

  DATA_MODE: z.enum(["auto", "live", "demo"]).default("auto"),

  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  COURTLISTENER_API_TOKEN: optionalString,
  COURTLISTENER_BASE_URL: z.string().default("https://www.courtlistener.com/api/rest/v4"),
  COURTLISTENER_DAILY_REQUEST_BUDGET: z.coerce.number().int().positive().default(120),
  COURTLISTENER_TIMEOUT_MS: z.coerce.number().int().positive().default(9000),
  COURTLISTENER_WEBHOOKS_ENABLED: bool,
  COURTLISTENER_WEBHOOK_SECRET: optionalString,
  COURTLISTENER_WEBHOOK_ENFORCE_IPS: bool,

  PACER_ENABLED: bool,
  PACER_ENVIRONMENT: z.enum(["qa", "production"]).default("qa"),
  PACER_USERNAME: optionalString,
  PACER_PASSWORD: optionalString,
  PACER_CLIENT_CODE: optionalString,
  PACER_MAX_DAILY_SPEND_USD: z.coerce.number().nonnegative().default(0),
  PACER_MAX_PAGES_PER_SEARCH: z.coerce.number().int().min(1).max(5).default(1),
  PACER_ALLOWED_PLANS: z.string().default("intelligence"),

  TRELLIS_API_KEY: optionalString,

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_PRICE_SEARCH: optionalString,
  STRIPE_PRICE_RESEARCH_PRO: optionalString,
  STRIPE_PRICE_INTELLIGENCE: optionalString,
  STRIPE_TRIAL_DAYS: z.coerce.number().int().min(0).max(30).default(7),

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),

  RESEND_API_KEY: optionalString,
  ALERTS_FROM_EMAIL: optionalString,

  CRON_SECRET: optionalString,
  ADMIN_EMAILS: z.string().default(""),
  IP_HASH_SALT: z.string().default("dev-only-salt-change-me"),

  PAYWALL_VARIANT: z.enum(["A", "B", "C", "split"]).default("split"),
  PAYWALL_WEIGHTS: z.string().default("A:34,B:33,C:33"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test hook: clears the memoized env so tests can mutate process.env. */
export function resetEnvForTests() {
  cached = null;
}

export type DataMode = "live" | "demo";

/**
 * `auto` resolves to live when a CourtListener token exists. Demo mode serves a clearly
 * labeled snapshot of public records and is never presented as live data.
 */
export function resolveDataMode(): DataMode {
  const env = getEnv();
  if (env.DATA_MODE === "live") return "live";
  if (env.DATA_MODE === "demo") return "demo";
  return env.COURTLISTENER_API_TOKEN ? "live" : "demo";
}

export const features = {
  supabase: () => Boolean(getEnv().NEXT_PUBLIC_SUPABASE_URL && getEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseAdmin: () => Boolean(getEnv().NEXT_PUBLIC_SUPABASE_URL && getEnv().SUPABASE_SERVICE_ROLE_KEY),
  stripe: () => Boolean(getEnv().STRIPE_SECRET_KEY),
  stripeWebhook: () => Boolean(getEnv().STRIPE_SECRET_KEY && getEnv().STRIPE_WEBHOOK_SECRET),
  ai: () => Boolean(getEnv().ANTHROPIC_API_KEY),
  email: () => Boolean(getEnv().RESEND_API_KEY && getEnv().ALERTS_FROM_EMAIL),
  pacer: () => {
    const e = getEnv();
    return Boolean(e.PACER_ENABLED && e.PACER_USERNAME && e.PACER_PASSWORD);
  },
  trellis: () => Boolean(getEnv().TRELLIS_API_KEY),
  courtlistenerLive: () => resolveDataMode() === "live" && Boolean(getEnv().COURTLISTENER_API_TOKEN),
};

export function adminEmails(): string[] {
  return getEnv()
    .ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
