// src/utils/complianceCore.js
// Pure compliance/financial calculations — no RN/Expo dependencies.

const LATE_FEE_PER_DAY = 50;
const LATE_FEE_MAX_NORMAL = 5000;
const LATE_FEE_MAX_NIL = 500;
const INTEREST_RATE_PA = 0.18;

export function calculateLateFee(dueDate, filingDate, isNilReturn = false) {
  const due = new Date(dueDate);
  const filed = new Date(filingDate ?? Date.now());
  const daysLate = Math.floor((filed - due) / (1000 * 60 * 60 * 24));
  if (daysLate <= 0) return { lateFee: 0, daysLate: 0, isLate: false };
  const cap = isNilReturn ? LATE_FEE_MAX_NIL : LATE_FEE_MAX_NORMAL;
  const lateFee = Math.min(daysLate * LATE_FEE_PER_DAY, cap);
  return { lateFee, daysLate, isLate: true, cap };
}

export function calculateInterest(taxAmount, dueDate, paymentDate) {
  const due = new Date(dueDate);
  const paid = new Date(paymentDate ?? Date.now());
  const daysLate = Math.floor((paid - due) / (1000 * 60 * 60 * 24));
  if (daysLate <= 0) return { interest: 0, daysLate: 0 };
  const interest = parseFloat((taxAmount * INTEREST_RATE_PA * (daysLate / 365)).toFixed(2));
  return { interest, daysLate };
}

export function buildReturnSummary(records) {
  const sum = (arr, f) => arr.reduce((s, r) => s + (r[f] ?? 0), 0);
  const b2b = records.filter(r => r.supplyType === 'B2B');
  const b2c = records.filter(r => r.supplyType !== 'B2B');
  const mk = arr => ({
    count: arr.length,
    taxableValue: sum(arr, 'taxableValue'),
    cgst: sum(arr, 'cgst'), sgst: sum(arr, 'sgst'), igst: sum(arr, 'igst'),
    totalTax: sum(arr, 'cgst') + sum(arr, 'sgst') + sum(arr, 'igst'),
  });
  const B = mk(b2b), C = mk(b2c);
  return {
    b2b: B, b2c: C,
    totals: {
      taxableValue: B.taxableValue + C.taxableValue,
      cgst: B.cgst + C.cgst, sgst: B.sgst + C.sgst, igst: B.igst + C.igst,
      totalTax: B.totalTax + C.totalTax,
    },
  };
}

export function checkNilReturn(records) {
  if (!records?.length) return { isNil: true };
  return { isNil: records.reduce((s, r) => s + (r.taxableValue ?? 0), 0) === 0 };
}

export function reconcileITC(claimedITC, eligibleITC) {
  const excess = claimedITC - eligibleITC;
  return {
    status: excess > 0 ? 'ITC_EXCESS' : 'ITC_MATCH',
    claimedITC, eligibleITC,
    excess: Math.max(0, excess),
  };
}
