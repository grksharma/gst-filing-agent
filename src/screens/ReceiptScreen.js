// src/screens/ReceiptScreen.js
// Success screen — shows ARN, summary, and links to the Drive-saved receipt.

import React from 'react';
import { View, ScrollView, StyleSheet, Linking } from 'react-native';
import { Text, Card, Button, Divider, Icon } from 'react-native-paper';
import { useStore } from '../hooks/useStore';

const fmt = n => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export default function ReceiptScreen({ route, navigation }) {
  const storeArn = useStore(s => s.arn);
  const storeDriveUrl = useStore(s => s.driveUrl);
  const storeSummary = useStore(s => s.summary);
  const profile = useStore(s => s.profile);
  const returnType = useStore(s => s.returnType);

  const record = route.params?.record;
  const arn = record?.arn ?? storeArn;
  const summary = record?.summary ?? storeSummary;
  const driveUrl = storeDriveUrl;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.successHeader}>
        <Icon source="check-circle" size={64} color="#0d7d3f" />
        <Text variant="headlineSmall" style={styles.successTitle}>Filing complete</Text>
        <Text variant="bodyMedium" style={styles.successSub}>
          Your {record?.returnType ?? returnType} has been submitted to GSTN.
        </Text>
      </View>

      <Card style={styles.arnCard}>
        <Card.Content>
          <Text variant="labelMedium" style={styles.arnLabel}>Acknowledgement Reference Number</Text>
          <Text variant="headlineSmall" selectable style={styles.arn}>{arn}</Text>
        </Card.Content>
      </Card>

      {summary && (
        <Card style={styles.card}>
          <Card.Title title="What was filed" />
          <Card.Content>
            <Row label="Business" value={profile?.tradeName} />
            <Row label="GSTIN" value={profile?.gstin} />
            <Divider style={styles.divider} />
            <Row label="Taxable value" value={fmt(summary?.totals?.taxableValue)} />
            <Row label="Total tax" value={fmt(summary?.totals?.totalTax)} bold />
          </Card.Content>
        </Card>
      )}

      <View style={styles.actions}>
        {driveUrl && (
          <Button mode="outlined" icon="cloud-download" onPress={() => Linking.openURL(driveUrl)}>
            View receipt in Drive
          </Button>
        )}
        <Button mode="contained" icon="home" onPress={() => navigation.navigate('Home')}>
          Back to home
        </Button>
      </View>
    </ScrollView>
  );
}

function Row({ label, value, bold }) {
  return (
    <View style={styles.row}>
      <Text variant="bodyMedium" style={bold && styles.bold}>{label}</Text>
      <Text variant="bodyMedium" style={[bold && styles.bold, styles.value]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60 },
  successHeader: { alignItems: 'center', marginBottom: 24 },
  successTitle: { fontWeight: '600', marginTop: 12 },
  successSub: { color: '#666', textAlign: 'center', marginTop: 4 },
  arnCard: { marginBottom: 16, backgroundColor: '#e6f4ea' },
  arnLabel: { color: '#0d7d3f' },
  arn: { fontFamily: 'monospace', fontWeight: '700', color: '#0d5c2f', marginTop: 4 },
  card: { marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  value: { flexShrink: 1, textAlign: 'right' },
  bold: { fontWeight: '700' },
  divider: { marginVertical: 8 },
  actions: { gap: 10, marginTop: 8 },
});
