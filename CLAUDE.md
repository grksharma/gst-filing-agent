# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npx expo start       # start dev server (press 'a' = Android, 'i' = iOS simulator)
npm run android      # launch on Android emulator
npm run ios          # launch on iOS simulator (Mac only)
npm test             # run all Jest tests
npm run lint         # ESLint over src/
```

Run a single test file:
```bash
npx jest __tests__/validation.test.js
```

Build installable binaries via EAS (requires `eas-cli` and an EAS account):
```bash
eas build --platform android --profile preview   # APK
eas build --platform ios --profile preview        # iOS simulator build
```

## Architecture

This is a **zero-infrastructure, fully on-device** React Native / Expo app for Indian GST filing. No backend exists — all processing (OCR, validation, tax calculation, GSTN payload generation) runs on the phone. The only external services are:
- **GSTN GSP API** — for filing returns
- **Google Drive REST API v3** — optional receipt backup (user's own account, `drive.file` scope only)

### 7-Agent Pipeline

The core is a sequential state machine in `src/agents/orchestrator.js` that runs 7 specialised agents in order. Each agent returns `{ ok: true, ...data }` or `{ ok: false, error }`.

| Stage | Agent | File |
|-------|-------|------|
| ONBOARDING | GSTIN validation + profile storage | `onboardingAgent.js` |
| INTAKE | Camera/file/CSV capture, quality scoring | `documentIntakeAgent.js` |
| EXTRACTION | On-device OCR (Tesseract.js), field parsing | `extractionAgent.js` |
| VALIDATION | GSTIN/HSN/rate checks, tax math, duplicate detection | `validationAgent.js` |
| COMPLIANCE | Late fees, ITC reconciliation, GSTN payload generation | `complianceAgent.js` |
| REVIEW | User approval gate (UI layer, not an agent) | — |
| FILING | OTP auth, GSP API submission, exponential-backoff retry | `filingAgent.js` |
| NOTIFICATION | Receipt PDF, Drive backup, push notification | `notificationAgent.js` |

Three feedback loops allow correction without restarting: Intake → re-upload, Validation → correction, Review → edit.

### State Management

- **Zustand** (`src/hooks/useStore.js`): UI-layer state (profile, current stage, records, compliance output, progress/errors).
- **AsyncStorage**: Orchestrator mid-flow state (`orchestrator_flow_state`) persisted across app restarts; also the audit log and idempotency keys (`filed_<gstin>_<returnType>_<year>_<month>`).
- **expo-secure-store**: GSTN auth tokens (encrypted).

The orchestrator emits progress events via a lightweight in-process event emitter (`onProgress(fn)` in `orchestrator.js`) — the UI subscribes to these rather than polling.

### Testable Core vs Agent Layer

Business logic lives in two pure JS files with no RN/Expo imports so they run in plain Node under Jest:
- `src/utils/validationCore.js` — GSTIN checksum, tax math, duplicate detection, rate validation
- `src/utils/complianceCore.js` — (imported by complianceAgent)

Agent files (`src/agents/*.js`) wrap this core with I/O (AsyncStorage, camera, network). Test the core directly; the agents are tested end-to-end in the app.

### Demo Mode

When `GSTN_APP_KEY` is empty in `app.json` extras, `filingAgent.js` skips the real GSTN API and returns a locally generated mock ARN. This lets you walk the entire pipeline without GSP credentials.

### Configuration

Set in `app.json` under `expo.extra`:
- `GOOGLE_CLIENT_ID_ANDROID` / `GOOGLE_CLIENT_ID_IOS` — for Drive backup OAuth
- `GSTN_SANDBOX_URL` — defaults to sandbox; change for production
- `GSTN_APP_KEY` — leave empty for demo mode; set to a real GSP key for live filing

### Navigation

`App.js` checks for a stored profile on startup and routes to `Home` (if onboarded) or `Onboarding`. Stack: `Onboarding → Home → Filing → Receipt`, with `Settings` as a modal.
