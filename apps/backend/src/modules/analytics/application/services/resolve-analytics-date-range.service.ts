import { Injectable } from '@nestjs/common';
import {
  zonedWallTimeToUtc,
  utcToZonedDateParts,
} from '../../domain/services/analytics-timezone.util';
import { InvalidAnalyticsRangeException } from '../exceptions/invalid-analytics-range.exception';
import { AnalyticsDateRange, AnalyticsDateRangeQuery } from '../dto/analytics-date-range.dto';

/** ADR-028 D5/D32: max query range, inclusive of both boundary days. */
export const ANALYTICS_MAX_RANGE_DAYS = 366;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Phase 14 (Analytics, ADR-028 Decision #4/D5). Resolves the frozen date
 * range contract (`today`/`last7d`/`last30d`/`thisMonth` presets, or
 * explicit `dateFrom`/`dateTo`, max 366 days) into UTC instant boundaries.
 * When `timezone` is provided (Branch-scoped routes), day boundaries are
 * resolved in that Branch's local wall-clock day - never UTC calendar days -
 * per ADR-028's timezone contract. Restaurant/Organization-scope routes pass
 * `timezone: null`, resolving boundaries in UTC, which is correct precisely
 * because those routes expose only non-bucketed aggregates (ADR-028
 * Decision #4) and never a Branch-local time series.
 */
@Injectable()
export class ResolveAnalyticsDateRangeService {
  resolve(query: AnalyticsDateRangeQuery, timezone: string | null, now: Date): AnalyticsDateRange {
    const presetGiven = query.range !== undefined;
    const explicitGiven = query.dateFrom !== undefined || query.dateTo !== undefined;

    if (presetGiven && explicitGiven) {
      throw new InvalidAnalyticsRangeException(
        'Provide either a "range" preset or explicit "dateFrom"/"dateTo", not both.',
      );
    }

    const { fromKey, toKey } = presetGiven
      ? this.resolvePresetKeys(query.range as AnalyticsRangePresetInternal, timezone, now)
      : this.resolveExplicitKeys(query.dateFrom, query.dateTo);

    if (fromKey > toKey) {
      throw new InvalidAnalyticsRangeException('"dateFrom" must not be after "dateTo".');
    }

    const spanDays = daysBetween(fromKey, toKey) + 1;
    if (spanDays > ANALYTICS_MAX_RANGE_DAYS) {
      throw new InvalidAnalyticsRangeException(
        `Requested range spans ${spanDays} days, exceeding the maximum of ${ANALYTICS_MAX_RANGE_DAYS} days.`,
      );
    }

    return {
      from: startOfDayKey(fromKey, timezone),
      to: endOfDayKey(toKey, timezone),
      fromKey,
      toKey,
    };
  }

  private resolvePresetKeys(
    preset: AnalyticsRangePresetInternal,
    timezone: string | null,
    now: Date,
  ): { fromKey: string; toKey: string } {
    const todayKey = dateKeyOf(now, timezone);

    switch (preset) {
      case 'today':
        return { fromKey: todayKey, toKey: todayKey };
      case 'last7d':
        return { fromKey: addDaysToKey(todayKey, -6), toKey: todayKey };
      case 'last30d':
        return { fromKey: addDaysToKey(todayKey, -29), toKey: todayKey };
      case 'thisMonth': {
        const [year, month] = todayKey.split('-');
        return { fromKey: `${year}-${month}-01`, toKey: todayKey };
      }
    }
  }

  private resolveExplicitKeys(
    dateFrom: string | undefined,
    dateTo: string | undefined,
  ): { fromKey: string; toKey: string } {
    if (dateFrom === undefined || dateTo === undefined) {
      throw new InvalidAnalyticsRangeException(
        'Both "dateFrom" and "dateTo" are required when not using a "range" preset.',
      );
    }
    if (!DATE_ONLY_PATTERN.test(dateFrom) || !DATE_ONLY_PATTERN.test(dateTo)) {
      throw new InvalidAnalyticsRangeException('"dateFrom"/"dateTo" must be YYYY-MM-DD dates.');
    }
    return { fromKey: dateFrom, toKey: dateTo };
  }
}

type AnalyticsRangePresetInternal = 'today' | 'last7d' | 'last30d' | 'thisMonth';

function dateKeyOf(instant: Date, timezone: string | null): string {
  if (timezone === null) {
    return instant.toISOString().slice(0, 10);
  }
  const { year, month, day } = utcToZonedDateParts(instant, timezone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDaysToKey(key: string, deltaDays: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate(),
  ).padStart(2, '0')}`;
}

function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86_400_000);
}

function startOfDayKey(key: string, timezone: string | null): Date {
  const [year, month, day] = key.split('-').map(Number);
  if (timezone === null) {
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  }
  return zonedWallTimeToUtc(year, month, day, 0, 0, 0, timezone);
}

function endOfDayKey(key: string, timezone: string | null): Date {
  const [year, month, day] = key.split('-').map(Number);
  if (timezone === null) {
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  }
  const startOfNextDay = zonedWallTimeToUtc(year, month, day, 23, 59, 59, timezone);
  return new Date(startOfNextDay.getTime() + 999);
}
