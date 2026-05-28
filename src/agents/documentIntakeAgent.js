// src/agents/documentIntakeAgent.js
// Agent 2 — Document Intake
// Accepts camera captures, PDFs, CSVs. Scores quality. Loops on failure.
// All file handling is local (expo-file-system). No uploads until user approves.

import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { MAX_UPLOAD_RETRIES } from '../constants/gst';

const SUPPORTED_MIME = [
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'text/csv', 'text/plain',
];

const MIN_IMAGE_RESOLUTION = { width: 800, height: 600 };
const MIN_FILE_SIZE_BYTES = 1024; // 1KB — reject obviously empty files
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * Open device camera and capture an invoice photo.
 */
export async function captureFromCamera() {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    return { ok: false, error: 'Camera permission denied. Please enable it in Settings.' };
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.92,
    allowsEditing: true,
    aspect: [3, 4],
    exif: false,
  });
  if (result.canceled) return { ok: false, error: 'Cancelled.' };
  const asset = result.assets[0];
  return buildFileRecord(asset.uri, 'image/jpeg', asset.width, asset.height);
}

/**
 * Pick files from device storage (PDF, image, CSV).
 */
export async function pickFromDevice(allowMultiple = true) {
  const result = await DocumentPicker.getDocumentAsync({
    type: SUPPORTED_MIME,
    multiple: allowMultiple,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return { ok: false, error: 'Cancelled.' };
  const files = await Promise.all(result.assets.map(a => buildFileRecord(a.uri, a.mimeType, null, null, a.name)));
  const failed = files.filter(f => !f.ok);
  const passed = files.filter(f => f.ok);
  return { ok: passed.length > 0, files: passed, errors: failed.map(f => f.error) };
}

/**
 * Build a normalised file record and score its quality.
 */
async function buildFileRecord(uri, mimeType, width, height, originalName) {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  if (!info.exists) return { ok: false, error: `File not found: ${uri}` };

  const size = info.size ?? 0;
  const qualityResult = scoreDocumentQuality({ size, mimeType, width, height });

  return {
    ok: qualityResult.acceptable,
    error: qualityResult.acceptable ? null : qualityResult.reason,
    uri,
    mimeType: mimeType ?? guessType(originalName ?? uri),
    originalName: originalName ?? uri.split('/').pop(),
    sizeBytes: size,
    width,
    height,
    qualityScore: qualityResult.score,
    qualityFlags: qualityResult.flags,
    capturedAt: new Date().toISOString(),
    type: categoriseFile(mimeType ?? guessType(uri)),
  };
}

/**
 * Score document quality — returns 0-1 score + flags.
 * Flags low resolution, small files, unsupported types.
 */
export function scoreDocumentQuality({ size, mimeType, width, height }) {
  const flags = [];
  let score = 1.0;

  if (size < MIN_FILE_SIZE_BYTES) {
    flags.push('FILE_TOO_SMALL');
    score -= 0.5;
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    flags.push('FILE_TOO_LARGE');
    score -= 0.3;
  }
  if (!SUPPORTED_MIME.includes(mimeType)) {
    flags.push('UNSUPPORTED_TYPE');
    score -= 0.8;
  }
  if (mimeType?.startsWith('image/')) {
    if (width && width < MIN_IMAGE_RESOLUTION.width) {
      flags.push('LOW_WIDTH');
      score -= 0.2;
    }
    if (height && height < MIN_IMAGE_RESOLUTION.height) {
      flags.push('LOW_HEIGHT');
      score -= 0.2;
    }
  }

  score = Math.max(0, score);
  const acceptable = score >= 0.5 && !flags.includes('UNSUPPORTED_TYPE');

  return {
    score,
    flags,
    acceptable,
    reason: acceptable ? null : buildQualityErrorMessage(flags),
  };
}

function buildQualityErrorMessage(flags) {
  const messages = {
    FILE_TOO_SMALL: 'The file appears to be empty or corrupt. Please try again.',
    FILE_TOO_LARGE: 'File exceeds 20 MB. Please compress or split the document.',
    UNSUPPORTED_TYPE: 'File type not supported. Use JPG, PNG, PDF, or CSV.',
    LOW_WIDTH: 'Image resolution is too low. Please capture from closer or use a higher-quality scan.',
    LOW_HEIGHT: 'Image is too short. Capture the full invoice in one frame.',
  };
  return flags.map(f => messages[f] ?? f).join(' ');
}

function categoriseFile(mimeType) {
  if (mimeType?.startsWith('image/')) return 'IMAGE';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType?.includes('csv') || mimeType?.includes('text')) return 'CSV';
  return 'UNKNOWN';
}

function guessType(filename) {
  const ext = filename?.split('.').pop()?.toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain' };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Main agent entry point.
 * Handles retry logic — up to MAX_UPLOAD_RETRIES per file.
 * Returns list of accepted file records ready for Agent 3.
 */
export async function runDocumentIntakeAgent(source = 'PICK') {
  const accepted = [];
  const rejected = [];
  let attempt = 0;

  while (attempt < MAX_UPLOAD_RETRIES) {
    attempt++;
    let result;

    if (source === 'CAMERA') {
      result = await captureFromCamera();
      if (!result.ok) return { ok: false, error: result.error, attempt };
      if (result.ok) {
        accepted.push(result);
        break;
      }
    } else {
      result = await pickFromDevice(true);
      if (!result.ok) return { ok: false, error: result.error || 'No valid files selected.', attempt };
      accepted.push(...result.files);
      if (result.errors?.length) rejected.push(...result.errors);
      break;
    }
  }

  if (accepted.length === 0) {
    return {
      ok: false,
      error: `Could not accept any documents after ${attempt} attempts. Please check file quality.`,
      attempt,
      rejected,
    };
  }

  return {
    ok: true,
    files: accepted,
    rejectedCount: rejected.length,
    warnings: rejected,
    totalSizeBytes: accepted.reduce((s, f) => s + (f.sizeBytes ?? 0), 0),
  };
}
