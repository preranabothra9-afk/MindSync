/**
 * WhatsApp-style day labels for chat separators.
 *
 * - Today / Yesterday for the last two calendar days
 * - The weekday ("Monday") once within the past week
 * - A full date beyond that
 *
 * Comparisons are calendar-day based, not 24h based: a message at 23:50 and one
 * at 00:10 are on different days even though they're 20 minutes apart.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight at the start of the given date's local day. */
function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

/** Whole calendar days between two dates (negative if `ago` is in the future). */
function dayDiff(from: Date, ago: Date): number {
  return Math.round((startOfDay(from).getTime() - startOfDay(ago).getTime()) / MS_PER_DAY);
}

/**
 * The separator label for a message sent at `iso`.
 *
 * @param iso  ISO timestamp of the message.
 * @param now  Override for the reference moment (defaults to the current time);
 *             tests pass a fixed value so labels stay deterministic.
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const sent = new Date(iso);
  if (isNaN(sent.getTime())) return '';

  const days = dayDiff(now, sent);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  // Within the last week, the weekday is more useful than a date the reader
  // has to parse. Beyond that, spell it out.
  if (days <= 6) {
    return sent.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return sent.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: sent.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/** True when two timestamps fall on the same calendar day. */
export function isSameDay(aIso: string, bIso: string): boolean {
  const a = new Date(aIso);
  const b = new Date(bIso);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return false;
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
