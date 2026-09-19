import { describe, expect, it } from 'vitest';
import { contentYear, formatContentDate } from './date.js';

describe('content dates', () => {
  const midnightUtc = new Date('2026-01-02');

  it('formats a date-only value on its UTC calendar day', () => {
    expect(
      formatContentDate(midnightUtc, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    ).toBe('2026年1月2日');
  });

  it('keeps the same day in numeric lists', () => {
    expect(
      formatContentDate(midnightUtc, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    ).toBe('2026/01/02');
  });

  it('keeps the same month and day in archives', () => {
    expect(formatContentDate(midnightUtc, { month: '2-digit', day: '2-digit' })).toBe('01/02');
  });

  it('groups by the UTC year at a calendar boundary', () => {
    expect(contentYear(new Date('2026-01-01'))).toBe(2026);
  });
});
