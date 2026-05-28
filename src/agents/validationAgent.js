// src/agents/validationAgent.js
// Agent 4 — Validation Engine
// Pure on-device logic. All rules run synchronously with plain-language error messages.

import { GSTIN_REGEX, GST_RATES, STATE_CODES } from '../constants/gst';

// ─────────────────────────────────────────────
// Individual validation rules
// Each returns { ok, field, code, message, value }
// ─────────────────────────────────────────────

export const rules = {

  gstinFormat(gstin, field = 'supplierGstin') {
    if (!gstin) return error(field, 'GSTIN_MISSING', 'GSTIN is required.');
    const g = gstin.trim().toUpperCase();
    if (!GSTIN_REGEX.test(g)) return error(field, 'GSTIN_FORMAT', `"${g}" is not a valid GSTIN. Format: 2-digit state + 10-char PAN + entity + Z + checksum.`);
    const state = g.slice(0, 2);
    if (!STATE_CODES[state]) return error(field, 'GSTIN_STATE', `State code ${state} in GSTIN is not recognised.`);
    return ok(field, g);
  },

  invoiceNo(no) {
    if (!no?.trim()) return error('invoiceNo', 'INV_NO_MISSING', 'Invoice number is required.');
    if (no.length > 16) return error('invoiceNo', 'INV_NO_LENGTH', `Invoice number "${no}" exceeds 16 characters (GST limit).`);
    return ok('invoiceNo', no.trim());
  },

  invoiceDate(dateStr) {
    if (!dateStr) return error('invoiceDate', 'DATE_MISSING', 'Invoice date is required.');
    const parsed = parseIndianDate(dateStr);
    if (!parsed) return error('invoiceDate', 'DATE_FORMAT', `Could not parse date "${dateStr}". Use DD/MM/YYYY format.`);
    if (parsed > new Date()) return error('invoiceDate', 'DATE_FUTURE', `Invoice date ${dateStr} is in the future.`);
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 3);
    if (parsed < cutoff) return error('invoiceDate', 'DATE_OLD', `Invoice date ${dateStr} is older than 3 years — ITC not claimable.`);
    return ok('invoiceDate', parsed.toISOString().split('T')[0]);
  },

  taxableValue(value) {
    const v = parseFloat(value);
    if (isNaN(v) || v < 0) return error('taxableValue', 'VALUE_INVALID', 'Taxable value must be a non-negative number.');
    if (v > 50000000) return error('taxableValue', 'VALUE_LARGE', `Taxable value ₹${v.toLocaleString('en-IN')} is unusually large. Please verify.`);
    return ok('taxableValue', v);
  },

  gstRate(rate) {
    const r = parseFloat(rate);
    if (isNaN(r)) return error('gstRate', 'RATE_MISSING', 'GST rate is missing. Check the invoice.');
    if (!GST_RATES.includes(r)) return error('gstRate', 'RATE_INVALID', `${r}% is not a valid GST rate. Valid rates: ${GST_RATES.join(', ')}%.`);
    return ok('gstRate', r);
  },

  taxAmountMath(record) {
    const { taxableValue, cgst, sgst, igst, totalAmount, gstRate } = record;
    if (!taxableValue || !gstRate) return ok('taxMath', null);

    const expectedTax = taxableValue * (gstRate / 100);
    const actualTax = (cgst ?? 0) + (sgst ?? 0) + (igst ?? 0);

    if (actualTax > 0 && Math.abs(actualTax - expectedTax) > 1.0) {
      return error('taxAmount', 'TAX_MISMATCH',
        `Tax amount ₹${actualTax.toFixed(2)} doesn't match expected ₹${expectedTax.toFixed(2)} at ${gstRate}% on ₹${taxableValue}. Check CGST/SGST/IGST split.`
      );
    }
    const expectedTotal = taxableValue + expectedTax;
    if (totalAmount && Math.abs(totalAmount - expectedTotal) > 2.0) {
      return error('totalAmount', 'TOTAL_MISMATCH',
        `Invoice total ₹${totalAmount} doesn't match calculated ₹${expectedTotal.toFixed(2)}. Verify if other charges (freight, discount) are included.`
      );
    }
    return ok('taxMath', { expectedTax, expectedTotal });
  },

  igstVsSgstCgst(record) {
    const hasBothCgstSgst = record.cgst > 0 && record.sgst > 0;
    const hasIgst = record.igst > 0;
    if (hasBothCgstSgst && hasIgst) {
      return error('igst', 'IGST_CGST_CONFLICT',
        'Invoice has both IGST and CGST/SGST. For intra-state supply use CGST+SGST; for inter-state supply use IGST only.');
    }
    return ok('taxSplit', null);
  },

  itcEligibility(record) {
    const warnings = [];
    if (record.gstRate === 0) warnings.push('Zero-rated supply — ITC not applicable on this invoice.');
    if (record.supplyType === 'B2C') warnings.push('B2C invoice — ITC cannot be claimed on purchases from unregistered buyers.');
    if (record.isReverseCharge) warnings.push('Reverse charge applicable — self-invoice required for ITC.');
    return { ...ok('itc', null), warnings };
  },

  hsnValidity(hsn) {
    if (!hsn) return { ...ok('hsnSac', null), warning: 'HSN/SAC code missing — optional for B2C but required for B2B above ₹5L turnover.' };
    const h = String(hsn).trim();
    if (!/^\d{4,8}$/.test(h)) return error('hsnSac', 'HSN_FORMAT', `HSN/SAC "${h}" must be 4–8 digits.`);
    return ok('hsnSac', h);
  },

  placeOfSupplyVsGstin(record) {
    if (!record.supplierGstin || !record.placeOfSupply) return ok('pos', null);
    const supplierState = record.supplierGstin.slice(0, 2);
    // Simple check: if POS state code doesn't match supplier state → inter-state → should have IGST
    const posStateCode = Object.entries(STATE_CODES).find(([, name]) =>
      record.placeOfSupply.toLowerCase().includes(name.toLowerCase())
    )?.[0];
    if (posStateCode && posStateCode !== supplierState && !record.igst) {
      return error('placeOfSupply', 'POS_MISMATCH',
        `Supply from ${STATE_CODES[supplierState]} to ${record.placeOfSupply} appears inter-state — IGST should be charged instead of CGST/SGST.`
      );
    }
    return ok('pos', null);
  },
};

// ─────────────────────────────────────────────
// Duplicate detection
// ─────────────────────────────────────────────

export function detectDuplicates(records) {
  const seen = new Map();
  const duplicates = [];

  for (const [idx, r] of records.entries()) {
    const key = `${r.supplierGstin}__${r.invoiceNo}`;
    if (seen.has(key)) {
      duplicates.push({
        index: idx,
        duplicateOf: seen.get(key),
        field: 'invoiceNo',
        code: 'DUPLICATE_INVOICE',
        message: `Invoice ${r.invoiceNo} from GSTIN ${r.supplierGstin} appears more than once. Remove the duplicate.`,
      });
    } else {
      seen.set(key, idx);
    }
  }
  return duplicates;
}

// ─────────────────────────────────────────────
// Aggregate validation run
// ─────────────────────────────────────────────

export function validateRecord(record) {
  const errors = [];
  const warnings = [];

  const check = (result) => {
    if (!result.ok) errors.push(result);
    if (result.warnings) warnings.push(...result.warnings.map(w => ({ field: result.field, message: w })));
  };

  check(rules.gstinFormat(record.supplierGstin, 'supplierGstin'));
  if (record.buyerGstin) check(rules.gstinFormat(record.buyerGstin, 'buyerGstin'));
  check(rules.invoiceNo(record.invoiceNo));
  check(rules.invoiceDate(record.invoiceDate));
  check(rules.taxableValue(record.taxableValue));
  check(rules.gstRate(record.gstRate));
  check(rules.taxAmountMath(record));
  check(rules.igstVsSgstCgst(record));
  check(rules.hsnValidity(record.hsnSac));
  check(rules.placeOfSupplyVsGstin(record));
  const itc = rules.itcEligibility(record);
  if (itc.warnings) warnings.push(...itc.warnings.map(w => ({ field: 'itc', message: w })));

  return { valid: errors.length === 0, errors, warnings, record };
}

/**
 * Main agent entry point.
 */
export function runValidationAgent(records) {
  if (!records?.length) return { ok: false, error: 'No records to validate.' };

  const results = records.map(validateRecord);
  const duplicates = detectDuplicates(records);

  const validRecords = results.filter(r => r.valid).map(r => r.record);
  const invalidRecords = results.filter(r => !r.valid);

  // Add duplicate errors to affected records
  duplicates.forEach(d => {
    if (invalidRecords[d.index]) {
      invalidRecords[d.index].errors.push(d);
    } else {
      results[d.index].valid = false;
      results[d.index].errors.push(d);
    }
  });

  const allWarnings = results.flatMap(r => r.warnings);

  return {
    ok: validRecords.length > 0,
    validRecords,
    invalidRecords: results.filter(r => !r.valid),
    warnings: allWarnings,
    duplicateCount: duplicates.length,
    summary: {
      total: records.length,
      valid: validRecords.length,
      invalid: results.filter(r => !r.valid).length,
      duplicates: duplicates.length,
    },
  };
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function ok(field, value) { return { ok: true, field, value }; }
function error(field, code, message) { return { ok: false, field, code, message }; }

function parseIndianDate(str) {
  const clean = str.replace(/[-\.]/g, '/');
  const parts = clean.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  const year = y < 100 ? 2000 + y : y;
  const date = new Date(year, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}
