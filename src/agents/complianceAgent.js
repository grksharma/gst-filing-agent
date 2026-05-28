// src/agents/complianceAgent.js
// Agent 5 — Compliance Advisor
// Pure on-device calculations. GSTR-2B match done against locally stored 2B JSON
// (downloaded once per period and cached in app storage).

import AsyncStorage from '@react-native-async-storage/async-storage';
import dayjs from 'dayjs';
import { FILING_TYPES } from '../constants/gst';

const LATE_FEE_PER_DAY = { GSTR1: 50, GSTR3B: 50, CMP08: 50 }; // ₹ per day
const LATE_FEE_MAX_NORMAL = 5000;  // ₹ cap per return
const LATE_FEE_MAX_NIL = 500;      // ₹ cap for nil returns
const INTEREST_RATE_PA = 0.18;     // 18% per annum on late tax payment

// ─────────────────────────────────────────────
// Late fee calculation
// ─────────────────────────────────────────────

export function calculateLateFee(returnType, dueDate, filingDate, isNilReturn = false) {
  const due = dayjs(dueDate);
  const filed = dayjs(filingDate ?? new Date());
  const daysLate = filed.diff(due, 'day');

  if (daysLate <= 0) return { lateFee: 0, daysLate: 0, isLate: false };

  const dailyFee = LATE_FEE_PER_DAY[returnType] ?? 50;
  const cap = isNilReturn ? LATE_FEE_MAX_NIL : LATE_FEE_MAX_NORMAL;
  const lateFee = Math.min(daysLate * dailyFee, cap);

  return {
    lateFee,
    daysLate,
    isLate: true,
    cap,
    message: `${daysLate} day(s) late — late fee of ₹${lateFee.toLocaleString('en-IN')} applies (CGST: ₹${lateFee / 2}, SGST: ₹${lateFee / 2}).`,
  };
}

// ─────────────────────────────────────────────
// Interest on tax payment delay
// ─────────────────────────────────────────────

export function calculateInterest(taxAmount, dueDate, paymentDate) {
  const due = dayjs(dueDate);
  const paid = dayjs(paymentDate ?? new Date());
  const daysLate = paid.diff(due, 'day');
  if (daysLate <= 0) return { interest: 0, daysLate: 0 };

  const interest = taxAmount * INTEREST_RATE_PA * (daysLate / 365);
  return {
    interest: parseFloat(interest.toFixed(2)),
    daysLate,
    rate: '18% p.a.',
    message: `Tax payment is ${daysLate} day(s) late — interest of ₹${interest.toFixed(2)} at 18% p.a. applies.`,
  };
}

// ─────────────────────────────────────────────
// GSTR-2B ITC reconciliation
// ─────────────────────────────────────────────

export async function reconcileWithGSTR2B(claimedITC, period) {
  const key = `gstr2b_${period.year}_${period.month}`;
  let gstr2bData = null;

  try {
    const raw = await AsyncStorage.getItem(key);
    gstr2bData = raw ? JSON.parse(raw) : null;
  } catch {
    // No 2B data cached — advisory only
  }

  if (!gstr2bData) {
    return {
      status: 'NO_2B_DATA',
      warning: 'GSTR-2B data not available for this period. Download it from the GST portal and import here for ITC reconciliation.',
      claimedITC,
      eligibleITC: null,
      mismatches: [],
    };
  }

  const eligibleITC = gstr2bData.itcAvailable ?? 0;
  const excess = claimedITC - eligibleITC;
  const mismatches = (gstr2bData.mismatches ?? []).map(m => ({
    supplierGstin: m.gstin,
    invoiceNo: m.docNo,
    claimedAmount: m.claimed,
    availableAmount: m.available,
    diff: m.claimed - m.available,
    message: `Supplier ${m.gstin}: Invoice ${m.docNo} — you claimed ₹${m.claimed} but GSTR-2B shows ₹${m.available}. Difference: ₹${(m.claimed - m.available).toFixed(2)}.`,
  }));

  return {
    status: excess > 0 ? 'ITC_EXCESS' : 'ITC_MATCH',
    claimedITC,
    eligibleITC,
    excess: Math.max(0, excess),
    mismatches,
    recommendation: excess > 0
      ? `Reduce ITC claim by ₹${excess.toFixed(2)} to match GSTR-2B. Excess ITC claims can attract notices under Rule 86A.`
      : 'ITC claim matches GSTR-2B. Safe to proceed.',
  };
}

// ─────────────────────────────────────────────
// Nil return check
// ─────────────────────────────────────────────

export function checkNilReturn(records) {
  if (!records?.length) {
    return {
      isNil: true,
      message: 'No transactions found for this period. This will be filed as a nil return.',
    };
  }
  const totalTaxable = records.reduce((s, r) => s + (r.taxableValue ?? 0), 0);
  if (totalTaxable === 0) {
    return { isNil: true, message: 'All transactions have zero taxable value — nil return.' };
  }
  return { isNil: false };
}

// ─────────────────────────────────────────────
// B2B / B2C split and summary
// ─────────────────────────────────────────────

export function buildReturnSummary(records) {
  const b2b = records.filter(r => r.supplyType === 'B2B');
  const b2c = records.filter(r => r.supplyType !== 'B2B');

  const sumField = (arr, field) => arr.reduce((s, r) => s + (r[field] ?? 0), 0);

  const b2bSummary = {
    count: b2b.length,
    taxableValue: sumField(b2b, 'taxableValue'),
    cgst: sumField(b2b, 'cgst'),
    sgst: sumField(b2b, 'sgst'),
    igst: sumField(b2b, 'igst'),
    totalTax: sumField(b2b, 'cgst') + sumField(b2b, 'sgst') + sumField(b2b, 'igst'),
  };
  const b2cSummary = {
    count: b2c.length,
    taxableValue: sumField(b2c, 'taxableValue'),
    cgst: sumField(b2c, 'cgst'),
    sgst: sumField(b2c, 'sgst'),
    igst: sumField(b2c, 'igst'),
    totalTax: sumField(b2c, 'cgst') + sumField(b2c, 'sgst') + sumField(b2c, 'igst'),
  };

  return {
    b2b: b2bSummary,
    b2c: b2cSummary,
    totals: {
      taxableValue: b2bSummary.taxableValue + b2cSummary.taxableValue,
      totalTax: b2bSummary.totalTax + b2cSummary.totalTax,
      cgst: b2bSummary.cgst + b2cSummary.cgst,
      sgst: b2bSummary.sgst + b2cSummary.sgst,
      igst: b2bSummary.igst + b2cSummary.igst,
    },
  };
}

// ─────────────────────────────────────────────
// Amendment detection
// ─────────────────────────────────────────────

export async function detectAmendments(currentRecords, period) {
  const prevKey = `filed_records_${period.year}_${period.month - 1}`;
  let prevRecords = [];
  try {
    const raw = await AsyncStorage.getItem(prevKey);
    prevRecords = raw ? JSON.parse(raw) : [];
  } catch { /* no prior filing data */ }

  const amendments = [];
  for (const rec of currentRecords) {
    const prev = prevRecords.find(p => p.invoiceNo === rec.invoiceNo && p.supplierGstin === rec.supplierGstin);
    if (prev) {
      const changes = [];
      if (Math.abs((prev.taxableValue ?? 0) - (rec.taxableValue ?? 0)) > 0.01)
        changes.push(`Taxable value changed: ₹${prev.taxableValue} → ₹${rec.taxableValue}`);
      if (prev.gstRate !== rec.gstRate)
        changes.push(`GST rate changed: ${prev.gstRate}% → ${rec.gstRate}%`);
      if (changes.length) amendments.push({ invoiceNo: rec.invoiceNo, changes });
    }
  }

  return amendments;
}

// ─────────────────────────────────────────────
// Main agent entry point
// ─────────────────────────────────────────────

export async function runComplianceAgent({ records, profile, period, returnType }) {
  const nilCheck = checkNilReturn(records);
  const summary = buildReturnSummary(records);

  const dueDate = computeDueDate(returnType, period, profile.filingFrequency);
  const lateFeeResult = calculateLateFee(returnType, dueDate, null, nilCheck.isNil);
  const interestResult = calculateInterest(summary.totals.totalTax, dueDate, null);

  const claimedITC = records.reduce((s, r) => s + ((r.cgst ?? 0) + (r.sgst ?? 0) + (r.igst ?? 0)), 0);
  const itcReconciliation = await reconcileWithGSTR2B(claimedITC, period);
  const amendments = await detectAmendments(records, period);

  const advisories = [];
  if (lateFeeResult.isLate) advisories.push({ type: 'LATE_FEE', ...lateFeeResult });
  if (interestResult.daysLate > 0) advisories.push({ type: 'INTEREST', ...interestResult });
  if (itcReconciliation.status === 'ITC_EXCESS') advisories.push({ type: 'ITC_EXCESS', ...itcReconciliation });
  if (itcReconciliation.mismatches?.length) advisories.push({ type: 'ITC_MISMATCH', mismatches: itcReconciliation.mismatches });
  if (amendments.length) advisories.push({ type: 'AMENDMENTS', amendments, message: `${amendments.length} invoice(s) appear to be amendments from a previous period.` });
  if (nilCheck.isNil) advisories.push({ type: 'NIL_RETURN', message: nilCheck.message });

  return {
    ok: true,
    summary,
    nilReturn: nilCheck.isNil,
    dueDate,
    lateFee: lateFeeResult,
    interest: interestResult,
    itcReconciliation,
    amendments,
    advisories,
    payload: buildReturnPayload({ records, summary, profile, period, returnType, lateFee: lateFeeResult }),
  };
}

// ─────────────────────────────────────────────
// Build GSTN-ready JSON payload
// ─────────────────────────────────────────────

function buildReturnPayload({ records, summary, profile, period, returnType }) {
  const base = {
    gstin: profile.gstin,
    fp: `${String(period.month).padStart(2, '0')}${period.year}`,
    returnType,
    generatedAt: new Date().toISOString(),
  };

  if (returnType === 'GSTR1') {
    return {
      ...base,
      b2b: records.filter(r => r.supplyType === 'B2B').map(mapToB2B),
      b2cs: records.filter(r => r.supplyType === 'B2C').map(mapToB2CS),
    };
  }

  if (returnType === 'GSTR3B') {
    return {
      ...base,
      sup_details: {
        osup_det: { txval: summary.totals.taxableValue, iamt: summary.totals.igst, camt: summary.totals.cgst, samt: summary.totals.sgst, csamt: 0 },
        osup_zero: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
        osup_nil_exmp: { txval: 0 },
        isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
        osup_nongst: { txval: 0 },
      },
      inter_sup: { unreg_details: [], comp_details: [], uin_details: [] },
      itc_elg: { itc_avl: [{ ty: 'IMPG', iamt: 0, camt: summary.b2b.cgst, samt: summary.b2b.sgst, csamt: 0 }], itc_rev: [], itc_net: [], itc_inelg: [] },
      inward_sup: { isup_details: [{ ty: 'GST', inter: 0, intra: 0 }] },
      intr_ltfee: { intr_details: [{ ty: 'T', intr: 0 }], ltfee_details: [{ ty: 'T', ltfee: 0 }] },
    };
  }

  if (returnType === 'CMP08') {
    return {
      ...base,
      supDetails: { osup_det: { txval: summary.totals.taxableValue, tax: summary.totals.totalTax } },
      inward_sup: { isup_details: [] },
    };
  }

  return base;
}

function mapToB2B(r) {
  return {
    ctin: r.buyerGstin,
    inv: [{
      inum: r.invoiceNo,
      idt: r.invoiceDate,
      val: r.totalAmount,
      pos: r.placeOfSupply ?? r.supplierGstin?.slice(0, 2),
      rchrg: r.isReverseCharge ? 'Y' : 'N',
      itms: [{ num: 1, itm_det: { txval: r.taxableValue, irt: r.gstRate, iamt: r.igst ?? 0, crt: r.gstRate / 2, camt: r.cgst ?? 0, srt: r.gstRate / 2, samt: r.sgst ?? 0, csrt: 0, csamt: 0 } }],
    }],
  };
}

function mapToB2CS(r) {
  return {
    sply_ty: 'INTRA',
    pos: r.placeOfSupply ?? r.supplierGstin?.slice(0, 2),
    rt: r.gstRate,
    txval: r.taxableValue,
    iamt: r.igst ?? 0,
    camt: r.cgst ?? 0,
    samt: r.sgst ?? 0,
    csamt: 0,
  };
}

function computeDueDate(returnType, period, frequency) {
  const cfg = FILING_TYPES[returnType]?.dueDates;
  if (!cfg) return null;
  const day = frequency === 'quarterly' ? (cfg.quarterly ?? cfg.monthly) : cfg.monthly;
  const date = new Date(period.year, period.month, day); // next month, day N
  return date.toISOString().split('T')[0];
}
