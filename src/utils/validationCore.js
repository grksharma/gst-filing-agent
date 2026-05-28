// src/utils/validationCore.js
// Pure validation functions with zero React Native / Expo dependencies.
// These are imported by validationAgent.js and are directly unit-testable.

export const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function verifyGSTINChecksum(gstin) {
  const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (!gstin || gstin.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const val = CHARS.indexOf(gstin[i]);
    if (val < 0) return false;
    const factor = (i % 2 === 0) ? 1 : 2;
    const product = val * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const checkDigit = CHARS[(36 - (sum % 36)) % 36];
  return checkDigit === gstin[14];
}

export function isValidGSTIN(gstin) {
  const g = gstin?.trim().toUpperCase();
  return !!g && GSTIN_REGEX.test(g) && verifyGSTINChecksum(g);
}

export function validateTaxMath({ taxableValue, cgst = 0, sgst = 0, igst = 0, totalAmount, gstRate }) {
  if (!taxableValue || gstRate == null) return { ok: true };
  const expectedTax = taxableValue * (gstRate / 100);
  const actualTax = cgst + sgst + igst;
  if (actualTax > 0 && Math.abs(actualTax - expectedTax) > 1.0) {
    return { ok: false, code: 'TAX_MISMATCH', expectedTax, actualTax };
  }
  if (totalAmount && Math.abs(totalAmount - (taxableValue + expectedTax)) > 2.0) {
    return { ok: false, code: 'TOTAL_MISMATCH', expected: taxableValue + expectedTax, actual: totalAmount };
  }
  return { ok: true, expectedTax };
}

export function detectTaxSplitConflict({ cgst = 0, sgst = 0, igst = 0 }) {
  if (cgst > 0 && sgst > 0 && igst > 0) return { ok: false, code: 'IGST_CGST_CONFLICT' };
  return { ok: true };
}

export function isValidRate(rate) {
  return GST_RATES.includes(parseFloat(rate));
}

export function deriveRate(taxableValue, totalTax) {
  if (!taxableValue) return null;
  const derived = (totalTax / taxableValue) * 100;
  return GST_RATES.reduce((a, b) => Math.abs(b - derived) < Math.abs(a - derived) ? b : a);
}

export function detectDuplicates(records) {
  const seen = new Map();
  const dupes = [];
  records.forEach((r, idx) => {
    const key = `${r.supplierGstin}__${r.invoiceNo}`;
    if (seen.has(key)) dupes.push({ index: idx, duplicateOf: seen.get(key) });
    else seen.set(key, idx);
  });
  return dupes;
}
