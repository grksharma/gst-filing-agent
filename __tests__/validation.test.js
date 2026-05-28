// __tests__/validation.test.js
import {
  isValidGSTIN, verifyGSTINChecksum, validateTaxMath,
  detectTaxSplitConflict, isValidRate, deriveRate, detectDuplicates,
} from '../src/utils/validationCore.js';

describe('GSTIN validation', () => {
  test('accepts a valid GSTIN', () => {
    expect(isValidGSTIN('27AAPFU0939F1ZV')).toBe(true);
  });
  test('rejects a GSTIN with bad checksum', () => {
    expect(isValidGSTIN('27AAPFU0939F1ZX')).toBe(false);
  });
  test('rejects malformed GSTIN', () => {
    expect(isValidGSTIN('27AAPFU0939F1Z')).toBe(false);
    expect(isValidGSTIN('')).toBe(false);
    expect(isValidGSTIN(null)).toBe(false);
  });
  test('checksum function handles wrong length', () => {
    expect(verifyGSTINChecksum('27AAPFU')).toBe(false);
  });
});

describe('Tax math validation', () => {
  test('passes correct intra-state CGST/SGST', () => {
    const r = validateTaxMath({ taxableValue: 10000, cgst: 900, sgst: 900, gstRate: 18, totalAmount: 11800 });
    expect(r.ok).toBe(true);
    expect(r.expectedTax).toBe(1800);
  });
  test('flags incorrect tax amount', () => {
    const r = validateTaxMath({ taxableValue: 10000, cgst: 500, sgst: 500, gstRate: 18 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TAX_MISMATCH');
  });
  test('passes correct inter-state IGST', () => {
    const r = validateTaxMath({ taxableValue: 50000, igst: 6000, gstRate: 12 });
    expect(r.ok).toBe(true);
  });
  test('flags total mismatch', () => {
    const r = validateTaxMath({ taxableValue: 10000, cgst: 900, sgst: 900, gstRate: 18, totalAmount: 15000 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TOTAL_MISMATCH');
  });
  test('skips when data incomplete', () => {
    expect(validateTaxMath({ taxableValue: 0, gstRate: 18 }).ok).toBe(true);
  });
});

describe('Tax split conflict', () => {
  test('flags both IGST and CGST/SGST present', () => {
    expect(detectTaxSplitConflict({ cgst: 100, sgst: 100, igst: 100 }).ok).toBe(false);
  });
  test('allows CGST+SGST only', () => {
    expect(detectTaxSplitConflict({ cgst: 100, sgst: 100 }).ok).toBe(true);
  });
  test('allows IGST only', () => {
    expect(detectTaxSplitConflict({ igst: 200 }).ok).toBe(true);
  });
});

describe('GST rate validation', () => {
  test('accepts standard rates', () => {
    [0, 5, 12, 18, 28].forEach(r => expect(isValidRate(r)).toBe(true));
  });
  test('rejects non-standard rate', () => {
    expect(isValidRate(15)).toBe(false);
    expect(isValidRate(20)).toBe(false);
  });
  test('derives nearest valid rate from amounts', () => {
    expect(deriveRate(10000, 1800)).toBe(18);
    expect(deriveRate(10000, 500)).toBe(5);
    expect(deriveRate(10000, 1150)).toBe(12);
  });
});

describe('Duplicate detection', () => {
  test('finds duplicate invoice from same supplier', () => {
    const records = [
      { supplierGstin: '27AAPFU0939F1ZV', invoiceNo: 'INV-1' },
      { supplierGstin: '27AAPFU0939F1ZV', invoiceNo: 'INV-2' },
      { supplierGstin: '27AAPFU0939F1ZV', invoiceNo: 'INV-1' },
    ];
    const dupes = detectDuplicates(records);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].index).toBe(2);
    expect(dupes[0].duplicateOf).toBe(0);
  });
  test('no false positives for unique invoices', () => {
    const records = [
      { supplierGstin: '27AAPFU0939F1ZV', invoiceNo: 'INV-1' },
      { supplierGstin: '29AABCT1332L1ZU', invoiceNo: 'INV-1' },
    ];
    expect(detectDuplicates(records)).toHaveLength(0);
  });
});
