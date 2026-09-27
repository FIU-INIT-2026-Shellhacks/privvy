/** Rate-limit module: per-IP limiter + CounterStore (Task 7). */
export type { CounterState, CounterStore } from './store.ts';
export {
  checkRateLimit,
  ipKey,
  type RateLimitConfig,
  type RateLimitDecision,
  type RateLimiterDeps,
} from './limiter.ts';
export { SupabaseCounterStore, type SupabaseCounterStoreOptions } from './supabase-store.ts';
