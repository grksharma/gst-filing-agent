// src/agents/extractionAgent.js
// Agent 3 — Data Extraction (OCR + rule-based parsing)
// Uses Tesseract.js for on-device OCR. No data leaves the phone.
// Processes files in configurable batches.

import { createWorker } from 'tesseract.js';
import * as FileSystem from 'expo-file-system';
import {
  GSTIN_REGEX,
  GST_RATES,
  OCR_CONFIDENCE_THRESHOLD,
  BATCH_SIZE,
} from '../constants/gst';

// ──────────────────────────────────────────
// Field extraction patterns (compiled once)
// ──────────────────────────────────────────
const PATTERNS = {
  gstin: /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g,
  invoiceNo: /(?:invoice\s*(?:no|number|#|num)[.:]\s*)([A-Z0-9/\-]+)/gi,
  invoiceDate: /(?:date[.:]\s*)(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/gi,
  taxableValue: /(?:taxable\s*(?:value|amount|base)[.:]\s*)(?:rs\.?\s*|₹\s*)?([0-9,]+\.?\d*)/gi,
  cgst: /(?:cgst\s*(?:@|at|rate)?[.:]\s*[\d.]+%?\s*)(?:rs\.?\s*|₹\s*)?([0-9,]+\.?\d*)/gi,
  sgst: /(?:sgst\s*(?:@|at|rate)?[.:]\s*[\d.]+%?\s*)(?:rs\.?\s*|₹\s*)?([0-9,]+\.?\d*)/gi,
  igst: /(?:igst\s*(?:@|at|rate)?[.:]\s*[\d.]+%?\s*)(?:rs\.?\s*|₹\s*)?([0-9,]+\.?\d*)/gi,
  totalAmount: /(?:total\s*(?:amount|value|invoice\s*value)[.:]\s*)(?:rs\.?\s*|₹\s*)?([0-9,]+\.?\d*)/gi,
  hsnSac: /(?:hsn\s*(?:\/\s*sac)?[.:]\s*)([0-9]{4,8})/gi,
  gstRate: /(?:gst\s*(?:rate|@|at)[.:]\s*)([\d.]+)\s*%/gi,
  placeOfSupply: /(?:place\s*of\s*supply[.:]\s*)([A-Za-z\s&]+?)(?:\n|$)/gi,
  buyerGstin: /(?:buyer(?:'s)?\s*gstin[.:]\s*)([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])/gi,
};

let ocrWorker = null;

/**
 * Lazily initialise Tesseract worker (reused across extractions).
 */
async function getOCRWorker() {
  if (!ocrWorker) {
    ocrWorker = await createWorker('eng', 1, {
      logger: () => {}, // suppress verbose logs
    });
    await ocrWorker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/\\-.,: ₹@#%()&\n',
      preserve_interword_spaces: '1',
    });
  }
  return ocrWorker;
}

/**
 * Run OCR on a single image file.
 */
async function ocrImage(uri) {
  const worker = await getOCRWorker();
  const { data } = await worker.recognize(uri);
  return {
    text: data.text,
    confidence: data.confidence / 100, // normalise to 0-1
    words: data.words,
  };
}

/**
 * Parse raw OCR text into structured invoice fields.
 * Returns extracted fields with per-field confidence.
 */
export function parseInvoiceText(rawText) {
  const text = rawText.replace(/\s+/g, ' ').trim();
  const fields = {};

  const extract = (pattern, key, transform = v => v) => {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      const raw = matches[0][1].replace(/,/g, '').trim();
      fields[key] = { value: transform(raw), raw, matchCount: matches.length };
    }
  };

  // Supplier GSTIN (first occurrence)
  const gstinMatches = [...text.matchAll(PATTERNS.gstin)];
  if (gstinMatches.length >= 1) {
    fields.supplierGstin = { value: gstinMatches[0][1], raw: gstinMatches[0][1] };
  }
  if (gstinMatches.length >= 2) {
    fields.buyerGstin = { value: gstinMatches[1][1], raw: gstinMatches[1][1] };
  }

  extract(PATTERNS.invoiceNo, 'invoiceNo');
  extract(PATTERNS.invoiceDate, 'invoiceDate');
  extract(PATTERNS.taxableValue, 'taxableValue', parseFloat);
  extract(PATTERNS.cgst, 'cgst', parseFloat);
  extract(PATTERNS.sgst, 'sgst', parseFloat);
  extract(PATTERNS.igst, 'igst', parseFloat);
  extract(PATTERNS.totalAmount, 'totalAmount', parseFloat);
  extract(PATTERNS.hsnSac, 'hsnSac');
  extract(PATTERNS.gstRate, 'gstRate', parseFloat);
  extract(PATTERNS.placeOfSupply, 'placeOfSupply', v => v.trim());

  // Derive missing values
  if (!fields.gstRate && (fields.cgst || fields.igst) && fields.taxableValue?.value) {
    const tax = (fields.cgst?.value ?? 0) + (fields.sgst?.value ?? 0) + (fields.igst?.value ?? 0);
    const derived = (tax / fields.taxableValue.value) * 100;
    const nearest = GST_RATES.reduce((a, b) => Math.abs(b - derived) < Math.abs(a - derived) ? b : a);
    fields.gstRate = { value: nearest, raw: derived.toFixed(2), derived: true };
  }

  // Classify B2B vs B2C
  fields.supplyType = {
    value: fields.buyerGstin?.value ? 'B2B' : 'B2C',
    raw: fields.buyerGstin?.value ?? 'NO_BUYER_GSTIN',
  };

  return fields;
}

/**
 * Score field-level confidence for an extracted record.
 * Returns overall score 0-1 and list of low-confidence fields.
 */
export function scoreExtraction(fields, ocrConfidence) {
  const required = ['supplierGstin', 'invoiceNo', 'taxableValue', 'totalAmount'];
  const present = required.filter(k => fields[k]?.value != null);
  const completeness = present.length / required.length;

  // Validate GSTIN format
  const gstinValid = fields.supplierGstin?.value
    ? GSTIN_REGEX.test(fields.supplierGstin.value)
    : false;

  // Validate GST rate
  const rateValid = fields.gstRate?.value != null
    ? GST_RATES.includes(fields.gstRate.value)
    : true; // not penalised if absent

  const structuralScore = (gstinValid ? 0.3 : 0) + (rateValid ? 0.2 : 0) + completeness * 0.5;
  const overall = ocrConfidence * 0.4 + structuralScore * 0.6;

  const missing = required.filter(k => !fields[k]?.value);

  return {
    overall: parseFloat(overall.toFixed(3)),
    ocrConfidence,
    completeness,
    needsReview: overall < OCR_CONFIDENCE_THRESHOLD,
    missingFields: missing,
    flags: [
      !gstinValid && 'INVALID_GSTIN',
      !rateValid && 'INVALID_GST_RATE',
      ...missing.map(f => `MISSING_${f.toUpperCase()}`),
    ].filter(Boolean),
  };
}

/**
 * Extract data from a CSV (Tally / bank export).
 */
export function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));

  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));

    // Normalise common Tally export column names
    return {
      invoiceNo: row.voucher_no ?? row.invoice_no ?? row.bill_no,
      invoiceDate: row.date ?? row.voucher_date,
      supplierGstin: row.party_gstin ?? row.gstin ?? row.supplier_gstin,
      buyerGstin: row.buyer_gstin ?? row.customer_gstin,
      taxableValue: parseFloat(row.taxable_value ?? row.taxable_amount ?? row.net_amount ?? 0),
      totalAmount: parseFloat(row.total ?? row.total_amount ?? row.invoice_value ?? 0),
      gstRate: parseFloat(row.gst_rate ?? row.tax_rate ?? 0),
      hsnSac: row.hsn ?? row.hsn_sac ?? row.hsn_code,
      supplyType: row.supply_type ?? (row.buyer_gstin ? 'B2B' : 'B2C'),
      source: 'CSV',
    };
  }).filter(r => r.invoiceNo || r.taxableValue);
}

/**
 * Process a batch of files, returning structured invoice records.
 */
async function processBatch(files) {
  const results = [];
  for (const file of files) {
    try {
      let record;
      if (file.type === 'IMAGE') {
        const ocr = await ocrImage(file.uri);
        const fields = parseInvoiceText(ocr.text);
        const score = scoreExtraction(fields, ocr.confidence);
        record = { ...flattenFields(fields), score, source: 'OCR', fileUri: file.uri, originalName: file.originalName };
      } else if (file.type === 'CSV') {
        const text = await FileSystem.readAsStringAsync(file.uri);
        const rows = parseCSV(text);
        results.push(...rows.map(r => ({ ...r, score: { overall: 1.0, needsReview: false }, source: 'CSV' })));
        continue;
      } else if (file.type === 'PDF') {
        // PDF: convert pages to images for OCR (handled via expo-print preview in UI layer)
        record = { error: 'PDF_NEEDS_RENDER', fileUri: file.uri, originalName: file.originalName };
      }
      if (record) results.push(record);
    } catch (err) {
      results.push({ error: err.message, fileUri: file.uri, originalName: file.originalName });
    }
  }
  return results;
}

function flattenFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, typeof v === 'object' && v?.value !== undefined ? v.value : v])
  );
}

/**
 * Main agent entry point.
 * Processes files in batches of BATCH_SIZE. Returns structured records + flagged items.
 */
export async function runExtractionAgent(files) {
  if (!files?.length) return { ok: false, error: 'No files to process.' };

  const allRecords = [];
  const needsReview = [];
  const errors = [];

  // Process in batches
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchResults = await processBatch(batch);
    for (const r of batchResults) {
      if (r.error) {
        errors.push(r);
      } else if (r.score?.needsReview) {
        needsReview.push(r);
      } else {
        allRecords.push(r);
      }
    }
  }

  // Terminate worker after processing to free memory
  if (ocrWorker && files.every(f => f.type !== 'IMAGE')) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }

  return {
    ok: allRecords.length > 0 || needsReview.length > 0,
    records: allRecords,
    needsReview,
    errors,
    summary: {
      total: files.length,
      extracted: allRecords.length,
      flagged: needsReview.length,
      failed: errors.length,
    },
  };
}
