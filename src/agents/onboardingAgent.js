// src/agents/onboardingAgent.js
// Agent 1 — Onboarding & Context
// Runs entirely on-device. No network except GSTIN lookup via GSTN public API.

import * as SecureStore from 'expo-secure-store';
import { GSTIN_REGEX, PAN_REGEX, STATE_CODES, TURNOVER_TIERS } from '../constants/gst';

const PROFILE_KEY = 'gst_business_profile';

/**
 * Validates a GSTIN string.
 * Returns { valid: true, stateCode, pan } or { valid: false, reason }
 */
export function validateGSTIN(gstin) {
  const g = gstin?.trim().toUpperCase();
  if (!g) return { valid: false, reason: 'GSTIN cannot be empty.' };
  if (!GSTIN_REGEX.test(g)) {
    return {
      valid: false,
      reason: `GSTIN format is invalid. Expected: 2-digit state code + PAN + 1 entity + Z + 1 checksum. Got: ${g}`,
    };
  }
  const stateCode = g.slice(0, 2);
  if (!STATE_CODES[stateCode]) {
    return { valid: false, reason: `Unknown state code: ${stateCode}` };
  }
  // Luhn-style checksum for GSTIN
  if (!verifyGSTINChecksum(g)) {
    return { valid: false, reason: 'GSTIN checksum failed. Please re-enter carefully.' };
  }
  return {
    valid: true,
    stateCode,
    stateName: STATE_CODES[stateCode],
    pan: g.slice(2, 12),
  };
}

/**
 * GSTIN checksum per GST Council specification.
 */
function verifyGSTINChecksum(gstin) {
  const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const val = CHARS.indexOf(gstin[i]);
    const factor = (i % 2 === 0) ? 1 : 2;
    const product = val * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const checkDigit = CHARS[(36 - (sum % 36)) % 36];
  return checkDigit === gstin[14];
}

/**
 * Determine filing frequency and applicable return types
 * based on annual turnover.
 */
export function resolveFilingContext(profile) {
  const { annualTurnover, isCompositionDealer } = profile;

  if (isCompositionDealer) {
    return {
      frequency: 'quarterly',
      applicableReturns: ['CMP08'],
      tier: 'COMPOSITION',
    };
  }

  let tier = 'MEDIUM';
  let frequency = 'monthly';
  if (annualTurnover === 0 || annualTurnover <= TURNOVER_TIERS.MICRO.max) {
    tier = 'MICRO';
    frequency = 'quarterly'; // QRMP scheme eligible
  } else if (annualTurnover <= TURNOVER_TIERS.SMALL.max) {
    tier = 'SMALL';
    frequency = 'monthly';
  }

  return {
    frequency,
    applicableReturns: ['GSTR1', 'GSTR3B'],
    tier,
    qrmpEligible: tier === 'MICRO',
  };
}

/**
 * Load stored business profile from on-device secure storage.
 */
export async function loadProfile() {
  try {
    const raw = await SecureStore.getItemAsync(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Save business profile securely on-device.
 */
export async function saveProfile(profile) {
  const validated = validateProfile(profile);
  if (!validated.ok) throw new Error(validated.errors.join('\n'));
  await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify({
    ...profile,
    updatedAt: new Date().toISOString(),
  }));
  return profile;
}

/**
 * Delete stored profile (used on app reset / sign-out).
 */
export async function clearProfile() {
  await SecureStore.deleteItemAsync(PROFILE_KEY);
}

/**
 * Validate profile shape before saving.
 */
function validateProfile(profile) {
  const errors = [];
  const gstinResult = validateGSTIN(profile.gstin);
  if (!gstinResult.valid) errors.push(gstinResult.reason);
  if (!profile.tradeName?.trim()) errors.push('Trade name is required.');
  if (profile.annualTurnover == null || profile.annualTurnover < 0) errors.push('Annual turnover cannot be negative.');
  if (!PAN_REGEX.test(profile.pan?.trim().toUpperCase())) errors.push('PAN format is invalid.');
  return { ok: errors.length === 0, errors };
}

/**
 * Main agent entry point — called by orchestrator.
 * Returns fully resolved context for downstream agents.
 */
export async function runOnboardingAgent(input) {
  // 1. Try loading existing profile
  let profile = await loadProfile();

  // 2. If input overrides provided (first-time or update), save them
  if (input?.gstin) {
    const validation = validateGSTIN(input.gstin);
    if (!validation.valid) {
      return { ok: false, error: validation.reason, step: 'GSTIN_VALIDATION' };
    }
    profile = { ...profile, ...input, ...validation };
    await saveProfile(profile);
  }

  if (!profile) {
    return { ok: false, error: 'No business profile found. Please complete onboarding.', step: 'NO_PROFILE' };
  }

  // 3. Resolve filing context
  const filingContext = resolveFilingContext(profile);

  // 4. Determine current filing period
  const now = new Date();
  const period = {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    quarter: Math.ceil((now.getMonth() + 1) / 3),
    label: now.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
  };

  return {
    ok: true,
    profile,
    filingContext,
    period,
    isFirstTime: !profile.updatedAt,
  };
}
