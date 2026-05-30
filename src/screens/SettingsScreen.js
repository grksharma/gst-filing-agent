// src/screens/SettingsScreen.js
// Connect/disconnect Google Drive, view profile, reset app.

import React from 'react';
import { ScrollView, StyleSheet, Alert } from 'react-native';
import { Text, Card, Button, List } from 'react-native-paper';
import { useStore } from '../hooks/useStore';
import { clearProfile } from '../agents/onboardingAgent';

export default function SettingsScreen({ navigation }) {
  const profile = useStore(s => s.profile);

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
        <Card.Title title="Receipts" subtitle="All filings are saved on this device" />
        <Card.Content>
          <List.Item
            title="Share any receipt"
            description="Open the receipt from your filing history and tap Share to send it to Drive, WhatsApp, email, or any app."
            left={props => <List.Icon {...props} icon="share-variant" />}
          />
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
