// src/agents/orchestrator.js
// Master orchestrator — runs all 7 agents as a state machine.
// Entirely on-device. State persists to AsyncStorage so the user
// can leave the app mid-flow and resume from where they left off.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { runOnboardingAgent } from './onboardingAgent';
import { runDocumentIntakeAgent } from './documentIntakeAgent';
import { runExtractionAgent } from './extractionAgent';
import { runValidationAgent } from './validationAgent';
import { runComplianceAgent } from './complianceAgent';
import { runFilingAgent } from './filingAgent';
import { runNotificationAgent } from './notificationAgent';

// ─────────────────────────────────────────────
// State machine stages
// ─────────────────────────────────────────────

export const STAGES = {
  IDLE:         'IDLE',
  ONBOARDING:   'ONBOARDING',
  INTAKE:       'INTAKE',
  EXTRACTION:   'EXTRACTION',
  VALIDATION:   'VALIDATION',
  COMPLIANCE:   'COMPLIANCE',
  REVIEW:       'REVIEW',         // Awaiting user approval
  FILING:       'FILING',
  NOTIFICATION: 'NOTIFICATION',
  COMPLETE:     'COMPLETE',
  ERROR:        'ERROR',
};

const FLOW_STATE_KEY = 'orchestrator_flow_state';

// ─────────────────────────────────────────────
// Persist / restore mid-flow state
// ─────────────────────────────────────────────

export async function saveFlowState(state) {
  await AsyncStorage.setItem(FLOW_STATE_KEY, JSON.stringify(state));
}

export async function loadFlowState() {
  try {
    const raw = await AsyncStorage.getItem(FLOW_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function clearFlowState() {
  await AsyncStorage.removeItem(FLOW_STATE_KEY);
}

// ─────────────────────────────────────────────
// Audit trail helpers
// ─────────────────────────────────────────────

async function logStage(stage, status, meta = {}) {
  const logKey = 'orchestrator_audit';
  try {
    const raw = await AsyncStorage.getItem(logKey);
    const log = raw ? JSON.parse(raw) : [];
    log.push({ stage, status, ts: new Date().toISOString(), ...meta });
    await AsyncStorage.setItem(logKey, JSON.stringify(log.slice(-500))); // keep last 500 entries
  } catch { /* never block flow for audit failures */ }
}

// ─────────────────────────────────────────────
// Event emitter (for UI progress updates)
// ─────────────────────────────────────────────

const listeners = new Set();

export function onProgress(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event) {
  listeners.forEach(fn => { try { fn(event); } catch { /* ignore listener errors */ } });
}

// ─────────────────────────────────────────────
// Individual stage runners
// ─────────────────────────────────────────────

async function runStage(name, fn, ctx) {
  emit({ stage: name, status: 'running', ctx });
  await logStage(name, 'START');
  try {
    const result = await fn(ctx);
    if (!result.ok) {
      await logStage(name, 'FAIL', { error: result.error });
      emit({ stage: name, status: 'error', error: result.error, ctx });
      return { ...ctx, stage: STAGES.ERROR, lastError: { stage: name, ...result } };
    }
    await logStage(name, 'OK');
    emit({ stage: name, status: 'done', result, ctx });
    return { ...ctx, ...result, stage: name };
  } catch (err) {
    await logStage(name, 'EXCEPTION', { error: err.message });
    emit({ stage: name, status: 'error', error: err.message, ctx });
    return { ...ctx, stage: STAGES.ERROR, lastError: { stage: name, error: err.message } };
  }
}

// ─────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────

/**
 * Run the full 7-agent filing pipeline.
 *
 * @param {object} options
 * @param {object} options.onboardingInput    - { gstin, tradeName, pan, annualTurnover, ... }
 * @param {string} options.documentSource     - 'CAMERA' | 'PICK'
 * @param {string} options.returnType         - 'GSTR1' | 'GSTR3B' | 'CMP08'
 * @param {function} options.onUserReview     - async fn(reviewData) → { approved: true } | { approved: false, edits }
 * @param {function} options.onAuthRequired   - async fn(gstin) → { otp, sessionId } | null
 * @param {string|null} options.driveToken    - Google Drive access token (optional)
 * @param {function} options.onProgress       - Progress callback (same as onProgress() subscription)
 * @returns {Promise<object>} Final result
 */
export async function runFilingPipeline({
  onboardingInput,
  documentSource = 'PICK',
  returnType = 'GSTR3B',
  nilFiling = false,
  onUserReview,
  onAuthRequired,
}) {
  let ctx = { stage: STAGES.IDLE };

  // ── Agent 1: Onboarding ──────────────────────────────────
  ctx = await runStage(STAGES.ONBOARDING, async () => {
    return runOnboardingAgent(onboardingInput);
  }, ctx);
  if (ctx.stage === STAGES.ERROR) return ctx;

  const { profile, period } = ctx;
  await saveFlowState(ctx);

  if (nilFiling) {
    // Skip agents 2, 3, 4 — no documents, no invoices, empty records
    emit({ stage: STAGES.INTAKE, status: 'done', result: { files: [] }, ctx });
    emit({ stage: STAGES.EXTRACTION, status: 'done', result: { records: [] }, ctx });
    emit({ stage: STAGES.VALIDATION, status: 'done', result: { validRecords: [], invalidRecords: [] }, ctx });
    ctx = { ...ctx, files: [], records: [], validRecords: [], invalidRecords: [], needsReview: [], stage: STAGES.VALIDATION };
    await saveFlowState(ctx);
  } else {
    // ── Agent 2: Document Intake ───────────────────────────
    ctx = await runStage(STAGES.INTAKE, async () => {
      return runDocumentIntakeAgent(documentSource);
    }, ctx);
    if (ctx.stage === STAGES.ERROR) return ctx;

    const { files } = ctx;
    await saveFlowState(ctx);

    // ── Agent 3: Extraction ────────────────────────────────
    ctx = await runStage(STAGES.EXTRACTION, async () => {
      return runExtractionAgent(files);
    }, ctx);
    if (ctx.stage === STAGES.ERROR) return ctx;

    await saveFlowState(ctx);

    // ── Agent 4: Validation ────────────────────────────────
    const allExtracted = [...(ctx.records ?? []), ...(ctx.needsReview ?? [])];
    ctx = await runStage(STAGES.VALIDATION, async () => {
      return runValidationAgent(allExtracted);
    }, ctx);
    if (ctx.stage === STAGES.ERROR) return ctx;

    await saveFlowState(ctx);
  }

  // ── Agent 5: Compliance ──────────────────────────────────
  ctx = await runStage(STAGES.COMPLIANCE, async (c) => {
    return runComplianceAgent({
      records: c.validRecords,
      profile,
      period,
      returnType,
    });
  }, ctx);
  if (ctx.stage === STAGES.ERROR) return ctx;

  await saveFlowState(ctx);

  // ── User Review Gate ─────────────────────────────────────
  // Nil returns have nothing to review — auto-approve and proceed.
  if (!nilFiling) {
    emit({ stage: STAGES.REVIEW, status: 'awaiting', ctx });
    const reviewData = {
      summary: ctx.summary,
      advisories: ctx.advisories,
      payload: ctx.payload,
      warnings: ctx.warnings,
      invalidRecords: ctx.invalidRecords,
    };

    const reviewResult = await onUserReview(reviewData);

    if (!reviewResult.approved) {
      return {
        ok: false,
        stage: STAGES.REVIEW,
        needsEdit: true,
        editedRecords: reviewResult.edits,
        ctx,
      };
    }
  } else {
    emit({ stage: STAGES.REVIEW, status: 'done', ctx });
  }

  // ── Agent 6: Filing ──────────────────────────────────────
  // Check if auth is needed
  const { requiresAuth } = await preCheckAuth();
  if (requiresAuth && onAuthRequired) {
    const authInput = await onAuthRequired(profile.gstin);
    if (!authInput) {
      return { ok: false, stage: STAGES.FILING, error: 'Authentication cancelled by user.', ctx };
    }
    // Auth is handled in UI layer which calls authenticateWithOTP from filingAgent
  }

  ctx = await runStage(STAGES.FILING, async (c) => {
    return runFilingAgent({ payload: c.payload, profile, period, returnType });
  }, ctx);
  if (ctx.stage === STAGES.ERROR) return ctx;

  await saveFlowState(ctx);

  // ── Agent 7: Notification ────────────────────────────────
  ctx = await runStage(STAGES.NOTIFICATION, async (c) => {
    return runNotificationAgent({
      filingResult: { arn: c.arn, filedAt: c.filedAt, acknowledgement: c.acknowledgement, returnType },
      profile,
      period,
      summary: c.summary,
      returnType,
    });
  }, ctx);

  await clearFlowState(); // Clean up on success
  emit({ stage: STAGES.COMPLETE, status: 'done', ctx });

  return {
    ok: true,
    stage: STAGES.COMPLETE,
    arn: ctx.arn,
    filedAt: ctx.filedAt,
    summary: ctx.summary,
    driveUrl: ctx.results?.drive?.driveUrl,
  };
}

async function preCheckAuth() {
  // Demo mode: no GSP credentials → no auth needed, filing agent will mock the ARN
  const Constants = (await import('expo-constants')).default;
  const appKey = Constants.expoConfig?.extra?.GSTN_APP_KEY;
  if (!appKey || appKey === '') return { requiresAuth: false };

  const SecureStore = await import('expo-secure-store');
  const token = await SecureStore.getItemAsync('gstn_auth_token').catch(() => null);
  const expiry = await SecureStore.getItemAsync('gstn_token_expiry').catch(() => null);
  const valid = token && expiry && Date.now() < parseInt(expiry);
  return { requiresAuth: !valid };
}
