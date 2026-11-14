/** Timezone-aware bucketing helpers. All analytics accept an IANA timezone so a
 * trader's "day" matches their session, not the server's clock. */

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const partFormatters = new Map<string, Intl.DateTimeFormat>();

const dateFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter;
};

const partFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = partFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    });
    partFormatters.set(timeZone, formatter);
  }
  return formatter;
};

/** "YYYY-MM-DD" in the given timezone. */
export const dayKeyOf = (iso: string, timeZone = "UTC"): string =>
  dateFormatter(timeZone).format(new Date(iso));

/** "YYYY-MM" in the given timezone. */
export const monthKeyOf = (iso: string, timeZone = "UTC"): string =>
  dayKeyOf(iso, timeZone).slice(0, 7);

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const weekdayOf = (iso: string, timeZone = "UTC"): Weekday => {
  const parts = partFormatter(timeZone).formatToParts(new Date(iso));
  return (parts.find((p) => p.type === "weekday")?.value ?? "Sun") as Weekday;
};

/** Hour of day 0-23 in the given timezone. */
export const hourOf = (iso: string, timeZone = "UTC"): number => {
  const parts = partFormatter(timeZone).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return hour === 24 ? 0 : hour;
};

/**
 * The wall-clock parts of an instant in a timezone.
 *
 * The parts are the local reading of the instant, so a schedule that names a
 * local time can be compared with them.
 */
export interface WallClock {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
  readonly hour: number; // 0-23
  readonly minute: number; // 0-59
  readonly second: number; // 0-59
}

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

const wallFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = wallFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    wallFormatters.set(timeZone, formatter);
  }
  return formatter;
};

/** The local wall-clock reading of an instant in a timezone. */
export const wallClockOf = (epochMs: number, timeZone = "UTC"): WallClock => {
  const parts = wallFormatter(timeZone).formatToParts(new Date(epochMs));
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
};

/**
 * The UTC offset of a timezone at an instant, in milliseconds.
 *
 * The offset is the difference between the local reading of the instant and
 * the instant itself, so it is positive east of Greenwich.
 */
export const offsetAt = (epochMs: number, timeZone = "UTC"): number => {
  const wall = wallClockOf(epochMs, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
};

/** How a local wall-clock time resolves against a timezone's transitions. */
export type LocalResolution = "exact" | "gap" | "fold";

/** The instant a local wall-clock time names, and how it resolved. */
export interface LocalInstant {
  readonly epochMs: number;
  readonly resolution: LocalResolution;
}

const sameWallClock = (left: WallClock, right: WallClock): boolean =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute;

/**
 * Resolves a local wall-clock time to the instant it names.
 *
 * The rules are explicit, because a daylight-saving transition makes a local
 * time ambiguous or impossible:
 *
 * - `exact` — the local time exists once. The instant is it.
 * - `gap` — the local time does not exist (the clock jumped over it). The
 *   instant is the one the *pre-transition* offset names, which is forward
 *   through the gap: one occurrence, never zero.
 * - `fold` — the local time happens twice (the clock fell back). The instant is
 *   the *earlier* of the two: one occurrence, never two.
 */
export const localInstant = (wall: WallClock, timeZone = "UTC"): LocalInstant => {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const before = offsetAt(naive - 86_400_000, timeZone);
  const after = offsetAt(naive + 86_400_000, timeZone);
  const early = naive - before;
  const late = naive - after;
  if (before === after) {
    return { epochMs: early, resolution: "exact" };
  }
  const earlyMatches = sameWallClock(wallClockOf(early, timeZone), wall);
  const lateMatches = sameWallClock(wallClockOf(late, timeZone), wall);
  if (earlyMatches && lateMatches) {
    // A fold: the earlier instant wins, so the later one never becomes an
    // occurrence of its own.
    return { epochMs: Math.min(early, late), resolution: "fold" };
  }
  if (earlyMatches) return { epochMs: early, resolution: "exact" };
  if (lateMatches) return { epochMs: late, resolution: "exact" };
  // A gap: the local time never happens. The pre-transition offset names the
  // instant that is forward through the gap.
  return { epochMs: early, resolution: "gap" };
};

/** The local calendar date one day after the given one. */
const nextLocalDate = (wall: WallClock): WallClock => {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day);
  const next = new Date(asUtc + 86_400_000);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
};

/**
 * The next daily occurrence of a local time, strictly after `afterMs`.
 *
 * The occurrence is derived from the local calendar date, never by adding a
 * fixed duration, so a daylight-saving transition cannot produce two
 * occurrences on one day.
 */
export const nextDailyOccurrence = (
  timeZone: string,
  hour: number,
  minute: number,
  afterMs: number,
): number => {
  let date = wallClockOf(afterMs, timeZone);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = localInstant({ ...date, hour, minute, second: 0 }, timeZone).epochMs;
    if (candidate > afterMs) return candidate;
    date = nextLocalDate(date);
  }
  throw new Error(`No daily occurrence of ${hour}:${minute} found in ${timeZone}.`);
};
