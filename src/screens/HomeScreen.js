// src/screens/HomeScreen.js
// Main dashboard — pick return type, choose document source, view history.

import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Card, Button, SegmentedButtons, List, Chip, FAB } from 'react-native-paper';
import { useStore } from '../hooks/useStore';
import { getFilingHistory } from '../agents/notificationAgent';
import { FILING_TYPES } from '../constants/gst';
import dayjs from 'dayjs';

export default function HomeScreen({ navigation }) {
  const profile = useStore(s => s.profile);
  const returnType = useStore(s => s.returnType);
  const setReturnType = useStore(s => s.setReturnType);
  const driveConnected = useStore(s => s.driveConnected);
  const resetFlow = useStore(s => s.resetFlow);

  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (profile?.gstin) getFilingHistory(profile.gstin).then(setHistory);
  }, [profile]);

  const startFiling = (source) => {
    resetFlow();
    navigation.navigate('Filing', { documentSource: source });
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Profile header */}
        <Card style={styles.profileCard}>
          <Card.Content>
            <Text variant="titleLarge" style={styles.businessName}>{profile?.tradeName}</Text>
            <Text variant="bodyMedium" style={styles.gstin}>{profile?.gstin}</Text>
            <View style={styles.chipRow}>
              <Chip compact icon="map-marker">{profile?.stateName}</Chip>
              <Chip compact icon="calendar">{profile?.filingFrequency}</Chip>
              {driveConnected
                ? <Chip compact icon="cloud-check" style={styles.driveOk}>Drive connected</Chip>
                : <Chip compact icon="cloud-off-outline" onPress={() => navigation.navigate('Settings')}>Connect Drive</Chip>}
            </View>
          </Card.Content>
        </Card>

        {/* Return type selector */}
        <Text variant="titleMedium" style={styles.sectionTitle}>What are you filing?</Text>
        <SegmentedButtons
          value={returnType}
          onValueChange={setReturnType}
          buttons={Object.values(FILING_TYPES).map(ft => ({ value: ft.id, label: ft.label }))}
          style={styles.segmented}
        />
        <Text variant="bodySmall" style={styles.returnDesc}>
          {FILING_TYPES[returnType]?.description}
        </Text>

        {/* Action buttons */}
        <View style={styles.actions}>
          <Button mode="contained" icon="camera" onPress={() => startFiling('CAMERA')} style={styles.actionBtn}>
            Scan invoices
          </Button>
          <Button mode="contained-tonal" icon="file-upload" onPress={() => startFiling('PICK')} style={styles.actionBtn}>
            Upload files
          </Button>
        </View>

        {/* Filing history */}
        {history.length > 0 && (
          <>
            <Text variant="titleMedium" style={styles.sectionTitle}>Recent filings</Text>
            <Card style={styles.historyCard}>
              {history.slice(0, 5).map((h, i) => (
                <List.Item
                  key={i}
                  title={`${h.returnType} · ${h.period?.label}`}
                  description={`ARN: ${h.arn} · ${dayjs(h.filedAt).format('DD MMM YYYY')}`}
                  left={props => <List.Icon {...props} icon="check-circle" color="#0d7d3f" />}
                  onPress={() => navigation.navigate('Receipt', { record: h })}
                />
              ))}
            </Card>
          </>
        )}
      </ScrollView>

      <FAB icon="cog" style={styles.fab} onPress={() => navigation.navigate('Settings')} small />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingTop: 50 },
  profileCard: { marginBottom: 20, backgroundColor: '#1a73e8' },
  businessName: { color: 'white', fontWeight: '600' },
  gstin: { color: 'rgba(255,255,255,0.85)', marginBottom: 10, fontFamily: 'monospace' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  driveOk: { backgroundColor: '#e6f4ea' },
  sectionTitle: { fontWeight: '600', marginBottom: 10, marginTop: 8 },
  segmented: { marginBottom: 6 },
  returnDesc: { color: '#666', marginBottom: 20 },
  actions: { gap: 10, marginBottom: 24 },
  actionBtn: { paddingVertical: 4 },
  historyCard: { marginBottom: 20 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
