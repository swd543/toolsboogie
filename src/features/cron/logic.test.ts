import { describe, expect, it } from 'vitest';
import { buildCron, explainCron, fieldPlainText, matchesCron, nextRuns, parseCron } from './logic';

const ok = (expr: string) => {
  const r = parseCron(expr);
  if (!r.ok) throw new Error(`expected ${expr} to parse: ${r.error}`);
  return r.parsed;
};
const err = (expr: string) => {
  const r = parseCron(expr);
  if (r.ok) throw new Error(`expected ${expr} to fail`);
  return r;
};

describe('parseCron — fields', () => {
  it('parses a standard 5-field expression', () => {
    const p = ok('*/15 * * * *');
    expect(p.hasSeconds).toBe(false);
    expect(p.minute.values).toEqual([0, 15, 30, 45]);
    expect(p.minute.step).toBe(15);
    expect(p.hour.star).toBe(true);
    expect(p.dom.star).toBe(true);
    expect(p.month.star).toBe(true);
    expect(p.dow.star).toBe(true);
  });

  it('parses lists, ranges and names (case-insensitive)', () => {
    const p = ok('5 4 * * MON-Fri');
    expect(p.minute.values).toEqual([5]);
    expect(p.hour.values).toEqual([4]);
    expect(p.dow.values).toEqual([1, 2, 3, 4, 5]);
  });

  it('folds day-of-week 7 to Sunday (0)', () => {
    const p = ok('0 0 * * 7');
    expect(p.dow.values).toEqual([0]);
  });

  it('implements cronie `N/step` as N-max/step', () => {
    const p = ok('5/10 * * * *');
    expect(p.minute.values).toEqual([5, 15, 25, 35, 45, 55]);
  });

  it('parses day-of-month lists', () => {
    const p = ok('0 9 1,15 * *');
    expect(p.dom.values).toEqual([1, 15]);
  });

  it('parses 6-field expressions with a leading seconds field', () => {
    const p = ok('30 0 9 * * *');
    expect(p.hasSeconds).toBe(true);
    expect(p.seconds?.values).toEqual([30]);
    expect(p.minute.values).toEqual([0]);
    expect(p.hour.values).toEqual([9]);
  });
});

describe('parseCron — @-aliases', () => {
  it('expands @daily', () => {
    const p = ok('@daily');
    expect(p.alias).toBe('@daily');
    expect(p.minute.values).toEqual([0]);
    expect(p.hour.values).toEqual([0]);
  });

  it('expands @yearly', () => {
    const p = ok('@yearly');
    expect(p.month.values).toEqual([1]);
    expect(p.dom.values).toEqual([1]);
  });

  it('flags @reboot as non-time-based', () => {
    const p = ok('@reboot');
    expect(p.reboot).toBe(true);
  });

  it('rejects unknown aliases', () => {
    expect(err('@every5min').error).toContain('@-alias');
  });
});

describe('parseCron — errors', () => {
  it('rejects out-of-range values', () => {
    expect(err('60 * * * *').error).toContain('minute');
    expect(err('* 24 * * *').error).toContain('hour');
    expect(err('* * * 13 *').error).toContain('month');
    expect(err('* * * * 8').error).toContain('day-of-week');
  });

  it('rejects zero steps and wrapping ranges', () => {
    expect(err('*/0 * * * *').error).toContain('minute');
    expect(err('22-2 * * * *').error).toContain('minute');
  });

  it('rejects wrong field counts and garbage', () => {
    expect(err('* * * *').error).toContain('Expected 5 fields');
    expect(err('* * * * * * *').error).toContain('Seven-field');
    expect(err('a b c d e').error).toContain('minute');
    expect(err('').error).toContain('Empty');
  });
});

describe('matchesCron', () => {
  it('matches an exact weekly time', () => {
    const p = ok('0 9 * * 1');
    const monday = new Date(2026, 0, 5, 9, 0, 0); // 2026-01-05 is a Monday
    const tuesday = new Date(2026, 0, 6, 9, 0, 0);
    expect(matchesCron(p, monday)).toBe(true);
    expect(matchesCron(p, tuesday)).toBe(false);
    expect(matchesCron(p, new Date(2026, 0, 5, 8, 59, 0))).toBe(false);
  });

  it('applies the day-of-month / day-of-week union when both are restricted', () => {
    const p = ok('0 0 13 * 5'); // Friday OR the 13th
    // Friday the 13th (2026-01-09 is a Friday; 2026-02-13 is a Friday the 13th)
    expect(matchesCron(p, new Date(2026, 1, 13, 0, 0, 0))).toBe(true);
    // A Friday that is not the 13th (2026-01-09)
    expect(matchesCron(p, new Date(2026, 0, 9, 0, 0, 0))).toBe(true);
    // The 13th that is not a Friday (2026-01-13 is a Tuesday)
    expect(matchesCron(p, new Date(2026, 0, 13, 0, 0, 0))).toBe(true);
    // A Tuesday the 14th — neither
    expect(matchesCron(p, new Date(2026, 0, 14, 0, 0, 0))).toBe(false);
  });

  it('checks the seconds field for 6-field expressions', () => {
    const p = ok('30 0 9 * * *');
    expect(matchesCron(p, new Date(2026, 0, 5, 9, 0, 30))).toBe(true);
    expect(matchesCron(p, new Date(2026, 0, 5, 9, 0, 31))).toBe(false);
  });
});

describe('nextRuns', () => {
  it('lists the next weekly runs strictly after `from`', () => {
    const p = ok('0 9 * * 1');
    const from = new Date(2026, 0, 5, 10, 0, 0); // Monday 10:00 — same day is past
    const runs = nextRuns(p, from, 5);
    expect(runs).not.toBeNull();
    expect(runs!.length).toBe(5);
    for (const r of runs!) {
      expect(r.getDay()).toBe(1);
      expect(r.getHours()).toBe(9);
      expect(r.getMinutes()).toBe(0);
      expect(r.getTime()).toBeGreaterThan(from.getTime());
    }
    // Strictly increasing
    for (let i = 1; i < runs!.length; i++) {
      expect(runs![i]!.getTime()).toBeGreaterThan(runs![i - 1]!.getTime());
    }
    expect(runs![0]!.getDate()).toBe(12); // next Monday
  });

  it('returns null for schedules that never occur (Feb 30)', () => {
    const p = ok('0 0 30 2 *');
    expect(nextRuns(p, new Date(2026, 0, 1), 3)).toBeNull();
  });

  it('honours the seconds field (fires at the first allowed second)', () => {
    const p = ok('30 0 9 * * *');
    const from = new Date(2026, 0, 5, 8, 0, 0);
    const runs = nextRuns(p, from, 1)!;
    expect(runs[0]!.getHours()).toBe(9);
    expect(runs[0]!.getMinutes()).toBe(0);
    expect(runs[0]!.getSeconds()).toBe(30);
  });

  it('returns null for @reboot (no clock schedule)', () => {
    const p = ok('@reboot');
    expect(nextRuns(p, new Date(2026, 0, 1), 3)).toBeNull();
  });
});

describe('buildCron', () => {
  it('builds canonical expressions', () => {
    expect(buildCron({ mode: 'minute', everyMinutes: 15 })).toBe('*/15 * * * *');
    expect(buildCron({ mode: 'hourly', minuteOfHour: 30 })).toBe('30 * * * *');
    expect(buildCron({ mode: 'daily', hour: 9, minute: 30 })).toBe('30 9 * * *');
    expect(buildCron({ mode: 'weekly', days: [3, 1], hour: 9, minute: 30 })).toBe('30 9 * * 1,3');
    expect(buildCron({ mode: 'monthly', dayOfMonth: 1, hour: 0, minute: 0 })).toBe('0 0 1 * *');
    expect(buildCron({ mode: 'yearly', month: 1, dayOfMonth: 1, hour: 0, minute: 0 })).toBe(
      '0 0 1 1 *',
    );
  });

  it('clamps out-of-range options', () => {
    expect(buildCron({ mode: 'minute', everyMinutes: 99 })).toBe('*/59 * * * *');
    expect(buildCron({ mode: 'daily', hour: 25, minute: 5 })).toBe('5 23 * * *');
  });

  it('round-trips through the parser', () => {
    for (const e of ['*/15 * * * *', '30 9 * * 1,3', '0 0 1 1 *']) {
      expect(parseCron(buildCron({ mode: 'custom', custom: e })).ok).toBe(true);
    }
  });
});

describe('explainCron + fieldPlainText', () => {
  it('names the weekday in a weekly schedule', () => {
    const p = ok('0 9 * * 1');
    const s = explainCron(p);
    expect(s).toContain('Monday');
    expect(s).toContain('09:00');
  });

  it('describes steppers', () => {
    expect(explainCron(ok('*/15 * * * *')).toLowerCase()).toContain('every 15 minutes');
  });

  it('mentions the DOM/DOW union rule', () => {
    const s = explainCron(ok('0 0 13 * 5'));
    expect(s).toContain('OR');
  });

  it('produces a row per field', () => {
    const rows = fieldPlainText(ok('30 0 9 * * *'));
    expect(rows.map((r) => r.field)).toContain('Seconds');
    expect(rows.map((r) => r.field)).toContain('Day of week');
    expect(rows.length).toBe(6);
  });
});
