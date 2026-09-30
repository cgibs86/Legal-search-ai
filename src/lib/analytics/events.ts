/** Funnel events. Anything else is rejected by /api/events. No session recording. */
export const ANALYTICS_EVENTS = [
  "landing_viewed",
  "search_started",
  "search_completed",
  "results_found",
  "paywall_viewed",
  "signup_started",
  "signup_completed",
  "checkout_started",
  "subscription_activated",
  "first_result_opened",
  "first_project_created",
  "first_alert_created",
  "subscription_canceled",
  "payment_failed",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export function isAnalyticsEvent(name: string): name is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(name);
}
