# GST Filing Agent

A mobile app that helps small businesses in India file GST returns (GSTR-1, GSTR-3B, CMP-08) by scanning invoices and walking through a guided, multi-agent pipeline. **The entire app runs on the user's phone.** There is no backend server and no cloud infrastructure to maintain — the only "cloud" is the user's own Google Drive, used for backing up receipts.

## Design principles

- **Zero infrastructure.** No backend, no database, no servers. All processing — OCR, validation, tax calculation, payload generation — happens on-device.
- **Privacy by default.** Business data and invoices never leave the phone except to (a) the official GSTN filing API and (b) the user's own Google Drive (optional, `drive.file` scope only — the app can only see files it creates).
- **Resilient.** Every long step has retry logic and plain-language error messages. The pipeline state is persisted, so a user can close the app mid-flow and resume.

## The 7 agents

The app is structured as a pipeline of seven specialised agents, coordinated by an on-device orchestrator (`src/agents/orchestrator.js`).

| # | Agent | File | Responsibility |
|---|-------|------|----------------|
| 1 | Onboarding | `onboardingAgent.js` | GSTIN validation (format + checksum), profile storage, filing-frequency resolution |
| 2 | Document Intake | `documentIntakeAgent.js` | Camera / file / CSV capture, quality scoring, re-upload loop (max 3) |
| 3 | Extraction | `extractionAgent.js` | On-device OCR (Tesseract.js), field parsing, per-field confidence scoring |
| 4 | Validation | `validationAgent.js` | GSTIN/HSN/rate checks, tax-math verification, duplicate detection, ITC eligibility |
| 5 | Compliance | `complianceAgent.js` | GSTR-2B reconciliation, late fee + interest, nil-return check, GSTN payload generation |
| 6 | Filing | `filingAgent.js` | OTP auth, GSP API submission, idempotency, exponential-backoff retry, error decoding |
| 7 | Notification | `notificationAgent.js` | Receipt PDF, Google Drive backup, push notification, next due-date reminder |

### Feedback loops

Three loops let users correct problems without restarting:

1. **Intake → re-upload** when a document fails the quality check.
2. **Validation → correction** when an invoice has errors; the agent returns a plain-language explanation and a fix hint.
3. **Review → edit** when the user wants to change something in the summary before approving.

### Failure handling

- **Document quality:** up to 3 re-upload attempts before giving up.
- **GSTN timeouts:** exponential backoff (5s → 15s → 45s), max 3 attempts.
- **Idempotency:** filings are keyed by `gstin + returnType + period`, so a retry never double-files.
- **GSTN error codes** are mapped to human-readable messages with specific fixes (see `GSTN_ERRORS` in `filingAgent.js`).
- **Audit log:** every agent step is written to an immutable on-device log.

## Tech stack

- **React Native + Expo** — runs on Android and iOS from one codebase.
- **Tesseract.js** — on-device OCR, no cloud vision API.
- **expo-secure-store** — encrypted on-device storage for profile and tokens.
- **Google Drive REST API v3** — optional receipt backup to the user's own account.
- **Zustand** — lightweight state management.

## Getting started

```bash
npm install
npx expo start
```

Then scan the QR code with the Expo Go app, or run on a simulator with `npm run android` / `npm run ios`.

### Configuration

Set these in `app.json` under `expo.extra`:

- `GOOGLE_CLIENT_ID_ANDROID` / `GOOGLE_CLIENT_ID_IOS` — OAuth client IDs for Drive backup.
- `GSTN_SANDBOX_URL` — GSP/GSTN API base URL (sandbox by default).
- `GSTN_APP_KEY` — your GSP application key.

> **Note:** Filing through GSTN requires a registered GST Suvidha Provider (GSP) account. In development the app points at the GSTN sandbox; production filing needs valid GSP credentials.

## Testing

The pure business logic (validation, tax math, compliance calculations) is fully unit-tested and runs in plain Node without any RN/Expo dependencies:

```bash
npm test
```

Core logic lives in `src/utils/validationCore.js` and `src/utils/complianceCore.js` specifically so it can be tested in isolation. 30 tests currently cover GSTIN checksums, tax-math verification, late-fee caps, interest, B2B/B2C splits, nil-return detection, ITC reconciliation, and duplicate detection.

## Project structure

```
src/
  agents/        The 7 agents + orchestrator state machine
  components/    Review sheet, OTP dialog
  screens/       Onboarding, Home, Filing, Receipt, Settings
  services/      Google Drive OAuth + file operations
  utils/         Pure, testable business logic
  hooks/         Zustand store
  constants/     GST rates, state codes, filing-type config
__tests__/       Jest test suites
```

## Disclaimer

This is reference implementation scaffolding. Production use requires a registered GSP, legal review of GST computations against current CGST rules, and thorough testing against the live GSTN sandbox.
