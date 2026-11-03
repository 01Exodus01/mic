/**
 * lib/rate-limit.ts
 * In-memory rate limiter and temporal lockout engine for authentication and submissions.
 *
 * Capabilities:
 *  1. Sliding window rate limiting (requests per time window).
 *  2. Brute-force lockout: blocks key for N seconds after M consecutive failures.
 *  3. Automatic cleanup of expired entries.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface LockoutEntry {
  failedAttempts: number;
  lockedUntil: number; // timestamp in ms
}

/**
 * Validates if a string is a valid IPv4 or IPv6 address.
 */
export function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const trimmed = ip.trim();
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/;
  if (ipv4Regex.test(trimmed)) return true;
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/;
  return ipv6Regex.test(trimmed);
}

import { env } from './env';

/**
 * Sanitizes IP extraction against X-Forwarded-For spoofing.
 * Only trusts proxy headers when TRUSTED_PROXY_HOPS is explicitly > 0.
 * Counts hops from right to left (the proxy closest to the server).
 */
export function extractClientIp(
  forwardedFor?: string | null,
  realIp?: string | null,
  trustedProxyHops: number = env.TRUSTED_PROXY_HOPS
): string {
  if (trustedProxyHops > 0 && forwardedFor) {
    const parts = forwardedFor.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= trustedProxyHops) {
      const candidate = parts[parts.length - trustedProxyHops];
      if (isValidIp(candidate)) {
        return candidate;
      }
    }
  }
  if (trustedProxyHops > 0 && realIp) {
    const trimmed = realIp.trim();
    if (isValidIp(trimmed)) {
      return trimmed;
    }
  }
  return '127.0.0.1';
}

/**
 * Safely extracts client IP from headers object.
 */
export function getClientIp(
  hdrs: { get: (name: string) => string | null },
  trustedProxyHops?: number
): string {
  return extractClientIp(
    hdrs.get('x-forwarded-for'),
    hdrs.get('x-real-ip'),
    trustedProxyHops
  );
}

const windowStore = new Map<string, RateLimitEntry>();
const lockoutStore = new Map<string, LockoutEntry>();

/**
 * Checks sliding window rate limit.
 *
 * @param key Unique key (e.g. "join:ip", "vote:participantId")
 * @param limit Maximum allowed requests
 * @param windowSec Window duration in seconds
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const windowMs = windowSec * 1000;

  const entry = windowStore.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    windowStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetIn: windowSec };
  }

  if (entry.count >= limit) {
    const resetIn = Math.ceil((entry.windowStart + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, resetIn };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: limit - entry.count,
    resetIn: Math.ceil((entry.windowStart + windowMs - now) / 1000),
  };
}

/**
 * Checks whether an entity is currently locked out.
 */
export function checkLockout(key: string): { isLocked: boolean; remainingSec: number } {
  const now = Date.now();
  const entry = lockoutStore.get(key);

  if (!entry || entry.lockedUntil <= now) {
    if (entry && entry.lockedUntil <= now) {
      lockoutStore.delete(key);
    }
    return { isLocked: false, remainingSec: 0 };
  }

  const remainingSec = Math.ceil((entry.lockedUntil - now) / 1000);
  return { isLocked: true, remainingSec };
}

/**
 * Records a failed credential or PIN attempt.
 * If consecutive failures reach `maxAttempts`, locks the key for `lockoutSec`.
 */
export function recordFailedAttempt(
  key: string,
  maxAttempts = 5,
  lockoutSec = 900 // 15 minutes
): { isLocked: boolean; attemptsLeft: number; remainingSec: number } {
  const now = Date.now();
  const entry = lockoutStore.get(key) || { failedAttempts: 0, lockedUntil: 0 };

  // If previous lockout expired, reset
  if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
    entry.failedAttempts = 0;
    entry.lockedUntil = 0;
  }

  // If already locked
  if (entry.lockedUntil > now) {
    return {
      isLocked: true,
      attemptsLeft: 0,
      remainingSec: Math.ceil((entry.lockedUntil - now) / 1000),
    };
  }

  entry.failedAttempts += 1;

  if (entry.failedAttempts >= maxAttempts) {
    entry.lockedUntil = now + lockoutSec * 1000;
    lockoutStore.set(key, entry);
    return {
      isLocked: true,
      attemptsLeft: 0,
      remainingSec: lockoutSec,
    };
  }

  lockoutStore.set(key, entry);
  return {
    isLocked: false,
    attemptsLeft: maxAttempts - entry.failedAttempts,
    remainingSec: 0,
  };
}

/**
 * Clears failed attempt tracking upon successful authentication.
 */
export function resetFailedAttempts(key: string): void {
  lockoutStore.delete(key);
}

// Periodic cleanup of stale memory records
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windowStore.entries()) {
      if (now - entry.windowStart > 300_000) {
        windowStore.delete(key);
      }
    }
    for (const [key, entry] of lockoutStore.entries()) {
      if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
        lockoutStore.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}
