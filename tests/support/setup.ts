// Deterministic, offline test environment: demo data, no external services.
process.env.DATA_MODE = process.env.DATA_MODE ?? "demo";
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.RESEND_API_KEY;
