// src/screens/SettingsScreen.js
// Connect/disconnect Google Drive, view profile, reset app.

import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { Text, Card, Button, List, Divider } from 'react-native-paper';
import Constants from 'expo-constants';
import { useStore } from '../hooks/useStore';
import { clearProfile } from '../agents/onboardingAgent';
import {
  buildAuthRequest,
  exchangeCodeForTokens,
  revokeGDriveAccess,
  getValidAccessToken,
} from '../services/googleDriveService';

export default function SettingsScreen({ navigation }) {
  const profile = useStore(s => s.profile);
  const driveConnected = useStore(s => s.driveConnected);
  const setDrive = useStore(s => s.setDrive);
  const [connecting, setConnecting] = useState(false);

  const clientId = Constants.expoConfig?.extra?.GOOGLE_CLIENT_ID_ANDROID
    ?? Constants.expoConfig?.extra?.GOOGLE_CLIENT_ID_IOS;

  const connectDrive = async () => {
    setConnecting(true);
    try {
      const { request, redirectUri, discovery } = buildAuthRequest(clientId);
      const result = await request.promptAsync(discovery);
      if (result.type === 'success' && result.params.code) {
        const token = await exchangeCodeForTokens(result.params.code, redirectUri, clientId);
        setDrive(true, token);
        Alert.alert('Connected', 'Your filings will now be backed up to your Google Drive.');
      }
    } catch (err) {
      Alert.alert('Connection failed', err.message);
    } finally {
      setConnecting(false);
    }
  };

  const disconnectDrive = async () => {
    await revokeGDriveAccess();
    setDrive(false, null);
    Alert.alert('Disconnected', 'Google Drive backup is now off. Local copies are kept on this device.');
  };

  const resetApp = () => {
    Alert.alert(
      'Reset app?',
      'This removes your saved profile from this device. Filing history in Google Drive is not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset', style: 'destructive', onPress: async () => {
            await clearProfile();
            navigation.replace('Onboarding');
          }
        },
      ]
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall" style={styles.title}>Settings</Text>

      <Card style={styles.card}>
        <Card.Title title="Storage" subtitle="Where your receipts are saved" />
        <Card.Content>
          <List.Item
            title="Google Drive"
            description={driveConnected
              ? 'Connected — receipts backed up automatically'
              : 'Not connected — receipts saved on this device only'}
            left={props => <List.Icon {...props} icon={driveConnected ? 'cloud-check' : 'cloud-off-outline'} />}
          />
          {driveConnected
            ? <Button mode="outlined" onPress={disconnectDrive}>Disconnect</Button>
            : <Button mode="contained" loading={connecting} onPress={connectDrive}>Connect Google Drive</Button>}
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Title title="Business profile" />
        <Card.Content>
          <List.Item title={profile?.tradeName} description={profile?.gstin} left={p => <List.Icon {...p} icon="domain" />} />
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Title title="Privacy" />
        <Card.Content>
          <Text variant="bodySmall" style={styles.privacyText}>
            This app runs entirely on your phone. Your business data and invoices never touch any
            server we control. Receipts are stored only on your device and, if you connect it, your
            own Google Drive. GSTN filing happens through the official government API.
          </Text>
        </Card.Content>
      </Card>

      <Button mode="text" textColor="#c5221f" onPress={resetApp} style={styles.reset}>
        Reset app
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50 },
  title: { fontWeight: '600', marginBottom: 16 },
  card: { marginBottom: 16 },
  privacyText: { color: '#555', lineHeight: 20 },
  reset: { marginTop: 8 },
});
