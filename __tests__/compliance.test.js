// __tests__/compliance.test.js
import {
  calculateLateFee, calculateInterest, buildReturnSummary,
  checkNilReturn, reconcileITC,
} from '../src/utils/complianceCore.js';

describe('Late fee calculation', () => {
  test('no fee when filed on time', () => {
    const r = calculateLateFee('2025-01-20', '2025-01-20');
    expect(r.lateFee).toBe(0);
    expect(r.isLate).toBe(false);
  });
  test('charges per-day fee', () => {
    const r = calculateLateFee('2025-01-20', '2025-01-25');
    expect(r.daysLate).toBe(5);
    expect(r.lateFee).toBe(250);
  });
  test('caps normal return at 5000', () => {
    const r = calculateLateFee('2025-01-20', '2026-01-20');
    expect(r.lateFee).toBe(5000);
  });
  test('caps nil return at 500', () => {
    const r = calculateLateFee('2025-01-20', '2025-03-20', true);
    expect(r.lateFee).toBe(500);
  });
});

describe('Interest calculation', () => {
  test('no interest when paid on time', () => {
    expect(calculateInterest(10000, '2025-01-20', '2025-01-20').interest).toBe(0);
  });
  test('computes 18% p.a. pro-rated', () => {
    const r = calculateInterest(100000, '2025-01-20', '2025-02-19'); // ~30 days
    expect(r.daysLate).toBe(30);
    expect(r.interest).toBeCloseTo(1479.45, 0);
  });
});

describe('Return summary', () => {
  test('splits B2B and B2C and totals correctly', () => {
    const records = [
      { supplyType: 'B2B', taxableValue: 10000, cgst: 900, sgst: 900 },
      { supplyType: 'B2C', taxableValue: 5000, cgst: 450, sgst: 450 },
      { supplyType: 'B2B', taxableValue: 20000, igst: 3600 },
    ];
    const s = buildReturnSummary(records);
    expect(s.b2b.count).toBe(2);
    expect(s.b2c.count).toBe(1);
    expect(s.totals.taxableValue).toBe(35000);
    expect(s.totals.totalTax).toBe(900 + 900 + 450 + 450 + 3600);
  });
});

describe('Nil return detection', () => {
  test('empty records is nil', () => {
    expect(checkNilReturn([]).isNil).toBe(true);
  });
  test('zero taxable value is nil', () => {
    expect(checkNilReturn([{ taxableValue: 0 }]).isNil).toBe(true);
  });
  test('non-zero is not nil', () => {
    expect(checkNilReturn([{ taxableValue: 100 }]).isNil).toBe(false);
  });
});

describe('ITC reconciliation', () => {
  test('flags excess claim', () => {
    const r = reconcileITC(5000, 4000);
    expect(r.status).toBe('ITC_EXCESS');
    expect(r.excess).toBe(1000);
  });
  test('matches when equal', () => {
    expect(reconcileITC(4000, 4000).status).toBe('ITC_MATCH');
  });
  test('no negative excess when claim is lower', () => {
    const r = reconcileITC(3000, 4000);
    expect(r.status).toBe('ITC_MATCH');
    expect(r.excess).toBe(0);
  });
});
