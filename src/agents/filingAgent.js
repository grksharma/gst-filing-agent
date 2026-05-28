// src/agents/filingAgent.js
// Agent 6 — GST Portal Filing
// Calls GSTN via GSP REST API. Handles OTP auth, exponential-backoff retry,
// idempotency (prevents duplicate submissions), and plain-language error decoding.

import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { MAX_FILING_RETRIES } from '../constants/gst';

const GSTN_SANDBOX = 'https://api.gstsystem.in/sandbox/v0.3';
const GSTN_PROD    = 'https://api.gstsystem.in/v0.3';

const baseURL = __DEV__ ? GSTN_SANDBOX : GSTN_PROD;

// ─────────────────────────────────────────────
// GSTN error code → human-readable explanation
// ─────────────────────────────────────────────

const GSTN_ERRORS = {
  'RET001': 'The GSTIN entered does not exist in GSTN. Verify your GSTIN and try again.',
  'RET002': 'Return for this period is already filed. No need to re-submit.',
  'RET003': 'The filing period is not open yet. Returns can be filed only after the period ends.',
  'RET004': 'Late filing: your previous return must be filed before this one. File pending returns first.',
  'RET005': 'Authentication token expired. Please re-authenticate with your OTP.',
  'RET011': 'Invalid invoice number format. Invoice numbers must be alphanumeric, max 16 characters.',
  'RET013': 'Buyer GSTIN does not exist in GSTN records. Verify the buyer GSTIN on the invoice.',
  'RET021': 'Taxable value mismatch detected. Check your CGST/SGST/IGST calculations.',
  'RET031': 'B2B invoice: place of supply must match buyer\'s state code.',
  'RET099': 'GSTN system is temporarily unavailable. This usually resolves within 30 minutes.',
  'AUTH001': 'OTP is incorrect or expired. Request a new OTP.',
  'AUTH002': 'EVC/DSC authentication failed. Ensure your registered mobile number is correct.',
  'REQINFO1': 'Request payload is malformed. Please contact support if this persists.',
  'REQINFO2': 'Filing period format is invalid. Expected MMYYYY.',
};

function decodeGSTNError(code, rawMessage) {
  return GSTN_ERRORS[code] ?? rawMessage ?? `Unknown error (code: ${code}). Please contact GSTN helpdesk at 0120-4888999.`;
}

// ─────────────────────────────────────────────
// Auth token management (stored securely on-device)
// ─────────────────────────────────────────────

const TOKEN_KEY = 'gstn_auth_token';
const TOKEN_EXPIRY_KEY = 'gstn_token_expiry';

async function getStoredToken() {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const expiry = await SecureStore.getItemAsync(TOKEN_EXPIRY_KEY);
    if (!token || !expiry) return null;
    if (Date.now() > parseInt(expiry)) return null; // expired
    return token;
  } catch { return null; }
}

async function storeToken(token, expiresInSeconds = 3600) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(TOKEN_EXPIRY_KEY, String(Date.now() + expiresInSeconds * 1000));
}

export async function clearToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(TOKEN_EXPIRY_KEY);
}

/**
 * Request OTP via GSTN API (triggers SMS to registered mobile).
 */
export async function requestOTP(gstin, appKey) {
  try {
    const res = await axios.post(`${baseURL}/authenticate/otp`, {
      action: 'OTPREQUEST',
      username: gstin,
      app_key: appKey,
    });
    return { ok: true, sessionId: res.data.session_id };
  } catch (err) {
    return { ok: false, error: decodeGSTNError(err.response?.data?.error_cd, err.message) };
  }
}

/**
 * Authenticate with OTP and receive auth token.
 */
export async function authenticateWithOTP(gstin, otp, sessionId) {
  try {
    const res = await axios.post(`${baseURL}/authenticate/token`, {
      action: 'AUTHTOKEN',
      username: gstin,
      app_key: otp,
      session_id: sessionId,
    });
    const token = res.data.auth_token;
    await storeToken(token, res.data.expiry ?? 3600);
    return { ok: true, token };
  } catch (err) {
    const code = err.response?.data?.error_cd;
    return { ok: false, error: decodeGSTNError(code, err.message), code };
  }
}

// ─────────────────────────────────────────────
// Idempotency — prevent double-filing
// ─────────────────────────────────────────────

async function checkAlreadyFiled(gstin, returnType, period) {
  const key = `filed_${gstin}_${returnType}_${period.year}_${period.month}`;
  const arn = await AsyncStorage.getItem(key);
  return arn ? { alreadyFiled: true, arn } : { alreadyFiled: false };
}

async function markAsFiled(gstin, returnType, period, arn) {
  const key = `filed_${gstin}_${returnType}_${period.year}_${period.month}`;
  await AsyncStorage.setItem(key, arn);
}

// ─────────────────────────────────────────────
// Submit return with retry logic
// ─────────────────────────────────────────────

async function submitReturn(payload, token, returnType) {
  const endpoint = {
    GSTR1: '/returns/gstr1',
    GSTR3B: '/returns/gstr3b',
    CMP08: '/returns/cmp08',
  }[returnType];

  if (!endpoint) throw new Error(`Unknown return type: ${returnType}`);

  const res = await axios.post(`${baseURL}${endpoint}`, payload, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: 30000, // 30s timeout
  });

  return res.data;
}

/**
 * Retry with exponential backoff.
 * Delays: 5s → 15s → 45s
 */
async function withRetry(fn, maxAttempts = MAX_FILING_RETRIES) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return { ok: true, data: await fn(), attempt };
    } catch (err) {
      lastError = err;
      const code = err.response?.data?.error_cd;

      // Don't retry auth errors or "already filed"
      if (code === 'RET002' || code === 'AUTH001') {
        return { ok: false, error: decodeGSTNError(code, err.message), code, attempt, noRetry: true };
      }

      if (attempt < maxAttempts) {
        const delayMs = Math.pow(3, attempt) * 5000; // 5s, 15s, 45s
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  const code = lastError?.response?.data?.error_cd;
  return {
    ok: false,
    error: decodeGSTNError(code, lastError?.message),
    code,
    attempt: maxAttempts,
    retryExhausted: true,
  };
}

// ─────────────────────────────────────────────
// Audit log (immutable, local)
// ─────────────────────────────────────────────

async function appendAuditLog(entry) {
  const key = 'filing_audit_log';
  try {
    const raw = await AsyncStorage.getItem(key);
    const log = raw ? JSON.parse(raw) : [];
    log.push({ ...entry, ts: new Date().toISOString() });
    await AsyncStorage.setItem(key, JSON.stringify(log));
  } catch { /* audit log failure must not block filing */ }
}

// ─────────────────────────────────────────────
// Main agent entry point
// ─────────────────────────────────────────────

export async function runFilingAgent({ payload, profile, period, returnType }) {
  const { gstin } = profile;

  // 1. Idempotency check
  const filedCheck = await checkAlreadyFiled(gstin, returnType, period);
  if (filedCheck.alreadyFiled) {
    return {
      ok: true,
      alreadyFiled: true,
      arn: filedCheck.arn,
      message: `${returnType} for ${period.label} is already filed. ARN: ${filedCheck.arn}`,
    };
  }

  // 2. Get auth token
  let token = await getStoredToken();
  if (!token) {
    return {
      ok: false,
      error: 'Authentication required. Please authenticate with OTP before filing.',
      requiresAuth: true,
    };
  }

  // 3. Submit with retry
  await appendAuditLog({ event: 'FILING_ATTEMPT', gstin, returnType, period });

  const result = await withRetry(() => submitReturn(payload, token, returnType));

  if (!result.ok) {
    await appendAuditLog({ event: 'FILING_FAILED', gstin, returnType, period, error: result.error, code: result.code });
    return {
      ok: false,
      error: result.error,
      code: result.code,
      attempts: result.attempt,
      retryExhausted: result.retryExhausted,
      fix: getFix(result.code),
    };
  }

  const arn = result.data?.arn ?? result.data?.reference_id;

  // 4. Mark as filed (idempotency)
  await markAsFiled(gstin, returnType, period, arn);
  await appendAuditLog({ event: 'FILING_SUCCESS', gstin, returnType, period, arn });

  return {
    ok: true,
    arn,
    acknowledgement: result.data,
    attempts: result.attempt,
    filedAt: new Date().toISOString(),
    message: `${returnType} filed successfully. ARN: ${arn}`,
  };
}

function getFix(code) {
  const fixes = {
    'RET011': 'Go back to the invoice list and correct invoice numbers that are longer than 16 characters.',
    'RET013': 'One or more buyer GSTINs are not registered. Verify GSTINs on the affected invoices.',
    'RET021': 'Review taxable value and tax amounts — check that CGST + SGST = total GST at the applicable rate.',
    'AUTH001': 'Tap "Re-authenticate" to request a new OTP.',
    'RET004': 'File your pending returns for earlier periods first, then come back to this one.',
  };
  return fixes[code] ?? 'Review the error and try again, or contact the GSTN helpdesk at 0120-4888999.';
}
