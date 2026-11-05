'use client';

/**
 * lib/telemetry/client.ts
 * Browser side of the usability telemetry (plan de mejora P2). Events are queued
 * and sent in small batches; when the page is hidden or closed the queue goes
 * out with navigator.sendBeacon. Failures are ignored: telemetry never blocks
 * or alerts the participant.
 */

import { useCallback, useEffect, useRef } from 'react';
import { MAX_EVENTS_PER_BATCH, type ClientEvent } from './events';

const ENDPOINT = '/api/participant/telemetry';
const FLUSH_DELAY_MS = 2000;

let queue: Array<{ event: ClientEvent; at: number }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function send(items: Array<{ event: ClientEvent; at: number }>, beacon: boolean): void {
  const sentAt = Date.now();
  const body = JSON.stringify({
    events: items.map((i) => i.event),
    ages_ms: items.map((i) => Math.max(0, Math.round(sentAt - i.at))),
  });
  try {
    if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => undefined);
  } catch {
    // ignore
  }
}

export function flushTelemetry(beacon = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length > 0) send(queue.splice(0, MAX_EVENTS_PER_BATCH), beacon);
}

export function trackEvent(event: ClientEvent): void {
  if (typeof window === 'undefined') return;
  if (!listening) {
    listening = true;
    window.addEventListener('pagehide', () => flushTelemetry(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushTelemetry(true);
    });
  }
  queue.push({ event, at: Date.now() });
  if (queue.length >= MAX_EVENTS_PER_BATCH) flushTelemetry();
  else if (!timer) timer = setTimeout(() => flushTelemetry(), FLUSH_DELAY_MS);
}

/**
 * P2.1: accumulates the time a report is really on screen: the page is visible
 * and `active` is true (on the vote screen the report is inside a collapsed
 * block). A report_read event is sent when that time ends (page hidden or left,
 * block closed, report changed), only if it was more than 0 ms. Returns a
 * callback to call when the participant expands one option of the report.
 */
export function useReportReadTracker(reportRound: number | null | undefined, surface: 'feedback' | 'vote', active = true) {
  const visibleSince = useRef<number | null>(null);
  const visibleMs = useRef(0);
  const sections = useRef(0);

  useEffect(() => {
    if (!reportRound) return;
    visibleMs.current = 0;
    sections.current = 0;

    const start = () => {
      if (visibleSince.current === null && active && document.visibilityState === 'visible') {
        visibleSince.current = Date.now();
      }
    };
    const stop = () => {
      if (visibleSince.current !== null) {
        visibleMs.current += Date.now() - visibleSince.current;
        visibleSince.current = null;
      }
    };
    const report = (beacon: boolean) => {
      stop();
      const ms = Math.round(visibleMs.current);
      if (ms > 0) {
        trackEvent({ type: 'report_read', report_round: reportRound, surface, visible_ms: ms, sections_opened: sections.current });
        flushTelemetry(beacon);
      }
      visibleMs.current = 0;
      sections.current = 0;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else report(true);
    };
    const onPageHide = () => report(true);

    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      report(false);
    };
  }, [reportRound, surface, active]);

  return useCallback(
    (optionId: string) => {
      if (!reportRound) return;
      sections.current += 1;
      trackEvent({ type: 'report_section_opened', report_round: reportRound, surface, option_id: optionId });
    },
    [reportRound, surface]
  );
}

const DEVICE_TAG_KEY = 'rfast_device_tag';

/**
 * P2.4: random tag this browser keeps (12 hex characters) so refused joins and
 * retries from one device can be counted. It identifies nobody and is not linked
 * to the name or code typed.
 */
export function getDeviceTag(): string | undefined {
  try {
    const stored = window.localStorage.getItem(DEVICE_TAG_KEY);
    if (stored && /^[a-f0-9]{12}$/.test(stored)) return stored;
    const bytes = new Uint8Array(6);
    window.crypto.getRandomValues(bytes);
    const tag = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    window.localStorage.setItem(DEVICE_TAG_KEY, tag);
    return tag;
  } catch {
    return undefined;
  }
}
