// src/hooks/useStore.js
// Global app state using Zustand. Lightweight, no provider needed.

import { create } from 'zustand';
import { STAGES } from '../agents/orchestrator';

export const useStore = create((set) => ({
  // Profile
  profile: null,
  setProfile: (profile) => set({ profile }),

  // Filing flow
  stage: STAGES.IDLE,
  setStage: (stage) => set({ stage }),

  returnType: 'GSTR3B',
  setReturnType: (returnType) => set({ returnType }),

  period: null,
  setPeriod: (period) => set({ period }),

  // Documents & records
  files: [],
  setFiles: (files) => set({ files }),

  records: [],
  setRecords: (records) => set({ records }),

  invalidRecords: [],
  needsReview: [],
  setReviewItems: (invalidRecords, needsReview) => set({ invalidRecords, needsReview }),

  // Compliance output
  summary: null,
  advisories: [],
  payload: null,
  setCompliance: ({ summary, advisories, payload }) => set({ summary, advisories, payload }),

  // Result
  arn: null,
  setResult: ({ arn }) => set({ arn }),

  // Progress / errors
  progress: { stage: null, status: null, message: null },
  setProgress: (progress) => set({ progress }),

  error: null,
  setError: (error) => set({ error }),

  // Reset the whole filing flow (keeps profile)
  resetFlow: () => set({
    stage: STAGES.IDLE,
    files: [],
    records: [],
    invalidRecords: [],
    needsReview: [],
    summary: null,
    advisories: [],
    payload: null,
    arn: null,
    driveUrl: null,
    error: null,
    progress: { stage: null, status: null, message: null },
  }),
}));
