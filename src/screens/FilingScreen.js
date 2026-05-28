// src/screens/FilingScreen.js
// Drives the 7-agent pipeline. Shows live progress, handles the review gate,
// and surfaces the final ARN. This is the heart of the user experience.

import React, { useState, useEffect, useRef } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Button, Card, ProgressBar, Chip, Divider, ActivityIndicator } from 'react-native-paper';
import { runFilingPipeline, STAGES, onProgress } from '../agents/orchestrator';
import { useStore } from '../hooks/useStore';
import ReviewSheet from '../components/ReviewSheet';
import AuthDialog from '../components/AuthDialog';

const STAGE_LABELS = {
  ONBOARDING: 'Loading profile',
  INTAKE: 'Reading documents',
  EXTRACTION: 'Extracting invoice data',
  VALIDATION: 'Validating',
  COMPLIANCE: 'Checking compliance',
  REVIEW: 'Awaiting your review',
  FILING: 'Filing with GSTN',
  NOTIFICATION: 'Saving receipt',
  COMPLETE: 'Done',
};

const STAGE_ORDER = ['ONBOARDING', 'INTAKE', 'EXTRACTION', 'VALIDATION', 'COMPLIANCE', 'REVIEW', 'FILING', 'NOTIFICATION', 'COMPLETE'];

export default function FilingScreen({ route, navigation }) {
  const { documentSource } = route.params ?? {};
  const profile = useStore(s => s.profile);
  const returnType = useStore(s => s.returnType);
  const driveToken = useStore(s => s.driveToken);
  const setResult = useStore(s => s.setResult);

  const [currentStage, setCurrentStage] = useState(null);
  const [stageStatus, setStageStatus] = useState('running');
  const [error, setError] = useState(null);
  const [reviewData, setReviewData] = useState(null);
  const [authNeeded, setAuthNeeded] = useState(false);

  const reviewResolver = useRef(null);
  const authResolver = useRef(null);

  useEffect(() => {
    const unsub = onProgress(evt => {
      setCurrentStage(evt.stage);
      setStageStatus(evt.status);
      if (evt.status === 'error') setError(evt.error);
    });
    startPipeline();
    return unsub;
  }, []);

  const startPipeline = async () => {
    const result = await runFilingPipeline({
      onboardingInput: null, // profile already saved
      documentSource,
      returnType,
      driveToken,
      onUserReview: (data) => new Promise(resolve => {
        setReviewData(data);
        reviewResolver.current = resolve;
      }),
      onAuthRequired: (gstin) => new Promise(resolve => {
        setAuthNeeded(true);
        authResolver.current = resolve;
      }),
    });

    if (result.ok) {
      setResult({ arn: result.arn, driveUrl: result.driveUrl });
      navigation.replace('Receipt');
    } else if (result.needsEdit) {
      // Re-open review with edits — handled by ReviewSheet
    } else {
      setError(result.error ?? result.lastError?.error);
    }
  };

  const handleReviewApprove = () => {
    setReviewData(null);
    reviewResolver.current?.({ approved: true });
  };

  const handleReviewEdit = (edits) => {
    setReviewData(null);
    reviewResolver.current?.({ approved: false, edits });
  };

  const handleAuthComplete = (authInput) => {
    setAuthNeeded(false);
    authResolver.current?.(authInput);
  };

  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  const progress = currentIndex >= 0 ? (currentIndex + 1) / STAGE_ORDER.length : 0;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="headlineSmall" style={styles.title}>Filing {returnType}</Text>
        <ProgressBar progress={progress} style={styles.progressBar} />

        {STAGE_ORDER.map(stage => {
          const idx = STAGE_ORDER.indexOf(stage);
          const isDone = idx < currentIndex;
          const isCurrent = stage === currentStage;
          return (
            <View key={stage} style={styles.stageRow}>
              {isDone ? (
                <Chip icon="check" compact mode="flat" style={styles.doneChip}>{STAGE_LABELS[stage]}</Chip>
              ) : isCurrent ? (
                <View style={styles.currentRow}>
                  {stageStatus === 'error'
                    ? <Chip icon="alert" compact mode="flat" style={styles.errorChip}>{STAGE_LABELS[stage]}</Chip>
                    : <><ActivityIndicator size={16} /><Text style={styles.currentLabel}>{STAGE_LABELS[stage]}…</Text></>}
                </View>
              ) : (
                <Text style={styles.pendingLabel}>{STAGE_LABELS[stage]}</Text>
              )}
            </View>
          );
        })}

        {error && (
          <Card style={styles.errorCard}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.errorTitle}>Something needs attention</Text>
              <Text variant="bodyMedium" style={styles.errorText}>{error}</Text>
            </Card.Content>
            <Card.Actions>
              <Button onPress={() => navigation.goBack()}>Go back</Button>
              <Button mode="contained" onPress={() => { setError(null); startPipeline(); }}>Retry</Button>
            </Card.Actions>
          </Card>
        )}
      </ScrollView>

      {reviewData && (
        <ReviewSheet
          data={reviewData}
          onApprove={handleReviewApprove}
          onEdit={handleReviewEdit}
        />
      )}

      {authNeeded && (
        <AuthDialog
          gstin={profile?.gstin}
          onComplete={handleAuthComplete}
          onCancel={() => handleAuthComplete(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 50 },
  title: { fontWeight: '600', marginBottom: 16 },
  progressBar: { height: 6, borderRadius: 3, marginBottom: 24 },
  stageRow: { marginBottom: 12 },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currentLabel: { fontWeight: '500', fontSize: 15 },
  pendingLabel: { color: '#aaa', fontSize: 15, paddingVertical: 4 },
  doneChip: { backgroundColor: '#e6f4ea', alignSelf: 'flex-start' },
  errorChip: { backgroundColor: '#fce8e6', alignSelf: 'flex-start' },
  errorCard: { marginTop: 24, backgroundColor: '#fff8f6' },
  errorTitle: { color: '#c5221f', marginBottom: 6 },
  errorText: { color: '#444' },
});
