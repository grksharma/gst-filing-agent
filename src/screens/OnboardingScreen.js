// src/screens/OnboardingScreen.js
// First-run screen — collects GSTIN, trade name, PAN, turnover.

import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { TextInput, Button, Text, HelperText, Switch, Card } from 'react-native-paper';
import { validateGSTIN, saveProfile } from '../agents/onboardingAgent';
import { useStore } from '../hooks/useStore';

export default function OnboardingScreen({ navigation }) {
  const setProfile = useStore(s => s.setProfile);

  const [gstin, setGstin] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [turnover, setTurnover] = useState('');
  const [isComposition, setIsComposition] = useState(false);
  const [gstinError, setGstinError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleGstinBlur = () => {
    if (!gstin) return;
    const result = validateGSTIN(gstin);
    setGstinError(result.valid ? '' : result.reason);
  };

  const handleSave = async () => {
    const gstinResult = validateGSTIN(gstin);
    if (!gstinResult.valid) {
      setGstinError(gstinResult.reason);
      return;
    }
    setSaving(true);
    try {
      const profile = {
        gstin: gstin.trim().toUpperCase(),
        tradeName: tradeName.trim(),
        pan: gstinResult.pan,
        stateCode: gstinResult.stateCode,
        stateName: gstinResult.stateName,
        annualTurnover: parseFloat(turnover) || 0,
        isCompositionDealer: isComposition,
        filingFrequency: isComposition ? 'quarterly' : (parseFloat(turnover) <= 4000000 ? 'quarterly' : 'monthly'),
      };
      await saveProfile(profile);
      setProfile(profile);
      navigation.replace('Home');
    } catch (err) {
      setGstinError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const canSave = gstin && tradeName && turnover && !gstinError;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>Set up your business</Text>
      <Text variant="bodyMedium" style={styles.subtitle}>
        Your details stay on this device. We never store them on any server.
      </Text>

      <Card style={styles.card}>
        <Card.Content>
          <TextInput
            label="GSTIN"
            value={gstin}
            onChangeText={t => setGstin(t.toUpperCase())}
            onBlur={handleGstinBlur}
            autoCapitalize="characters"
            maxLength={15}
            mode="outlined"
            error={!!gstinError}
            style={styles.input}
          />
          {!!gstinError && <HelperText type="error">{gstinError}</HelperText>}

          <TextInput
            label="Trade / Legal name"
            value={tradeName}
            onChangeText={setTradeName}
            mode="outlined"
            style={styles.input}
          />

          <TextInput
            label="Annual turnover (₹)"
            value={turnover}
            onChangeText={setTurnover}
            keyboardType="numeric"
            mode="outlined"
            style={styles.input}
          />
          <HelperText type="info">
            Used to determine monthly vs quarterly filing (QRMP scheme).
          </HelperText>

          <View style={styles.switchRow}>
            <Text variant="bodyLarge">Composition dealer</Text>
            <Switch value={isComposition} onValueChange={setIsComposition} />
          </View>
        </Card.Content>
      </Card>

      <Button
        mode="contained"
        onPress={handleSave}
        loading={saving}
        disabled={!canSave || saving}
        style={styles.button}
      >
        Save &amp; continue
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60 },
  title: { fontWeight: '600', marginBottom: 4 },
  subtitle: { color: '#666', marginBottom: 20 },
  card: { marginBottom: 20 },
  input: { marginBottom: 4 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  button: { paddingVertical: 6 },
});
