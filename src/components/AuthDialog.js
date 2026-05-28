// src/components/AuthDialog.js
// OTP authentication dialog. Triggered by Filing agent when no valid token exists.

import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Portal, Dialog, TextInput, Button, Text, HelperText } from 'react-native-paper';
import { requestOTP, authenticateWithOTP } from '../agents/filingAgent';
import Constants from 'expo-constants';

export default function AuthDialog({ gstin, onComplete, onCancel }) {
  const [step, setStep] = useState('request'); // 'request' | 'verify'
  const [otp, setOtp] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const appKey = Constants.expoConfig?.extra?.GSTN_APP_KEY ?? 'sandbox-app-key';

  const handleRequestOTP = async () => {
    setLoading(true);
    setError('');
    const result = await requestOTP(gstin, appKey);
    setLoading(false);
    if (result.ok) {
      setSessionId(result.sessionId);
      setStep('verify');
    } else {
      setError(result.error);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError('');
    const result = await authenticateWithOTP(gstin, otp, sessionId);
    setLoading(false);
    if (result.ok) {
      onComplete({ token: result.token });
    } else {
      setError(result.error);
    }
  };

  return (
    <Portal>
      <Dialog visible dismissable={false}>
        <Dialog.Title>Authenticate with GSTN</Dialog.Title>
        <Dialog.Content>
          {step === 'request' ? (
            <Text variant="bodyMedium">
              We'll send an OTP to the mobile number registered with GSTIN {gstin}. This authorises filing.
            </Text>
          ) : (
            <>
              <TextInput
                label="Enter OTP"
                value={otp}
                onChangeText={setOtp}
                keyboardType="numeric"
                maxLength={6}
                mode="outlined"
                autoFocus
              />
            </>
          )}
          {!!error && <HelperText type="error">{error}</HelperText>}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onCancel}>Cancel</Button>
          {step === 'request' ? (
            <Button mode="contained" onPress={handleRequestOTP} loading={loading}>Send OTP</Button>
          ) : (
            <Button mode="contained" onPress={handleVerify} loading={loading} disabled={otp.length < 6}>Verify</Button>
          )}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({});
