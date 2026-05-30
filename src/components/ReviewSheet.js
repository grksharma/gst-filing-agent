// src/components/ReviewSheet.js
// The user-approval gate between Compliance (Agent 5) and Filing (Agent 6).
// Shows the return summary, advisories, and any validation errors before submission.

import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Modal, Portal, Text, Button, Card, Divider, List, Banner } from 'react-native-paper';

const fmt = n => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const ADVISORY_ICONS = {
  LATE_FEE: 'clock-alert',
  INTEREST: 'percent',
  ITC_EXCESS: 'alert-circle',
  ITC_MISMATCH: 'file-compare',
  AMENDMENTS: 'pencil',
  NIL_RETURN: 'information',
};

export default function ReviewSheet({ data, onApprove, onEdit }) {
  const { summary, advisories = [], invalidRecords = [] } = data;
  const hasErrors = invalidRecords.length > 0;

  return (
    <Portal>
      <Modal visible dismissable={false} contentContainerStyle={styles.modal}>
        <Text variant="headlineSmall" style={styles.title}>Review before filing</Text>
        <ScrollView style={styles.scroll}>

          {hasErrors && (
            <Banner visible icon="alert" style={styles.errorBanner}>
              {invalidRecords.length} invoice(s) have errors. Fix them before filing, or remove them to continue.
            </Banner>
          )}

          {/* Summary card */}
          <Card style={styles.card}>
            <Card.Title title="Return summary" />
            <Card.Content>
              <Row label="Taxable value" value={fmt(summary?.totals?.taxableValue)} />
              <Row label="CGST" value={fmt(summary?.totals?.cgst)} />
              <Row label="SGST" value={fmt(summary?.totals?.sgst)} />
              <Row label="IGST" value={fmt(summary?.totals?.igst)} />
              <Divider style={styles.divider} />
              <Row label="Total tax" value={fmt(summary?.totals?.totalTax)} bold />
              <Divider style={styles.divider} />
              <Row label="B2B invoices" value={String(summary?.b2b?.count ?? 0)} />
              <Row label="B2C invoices" value={String(summary?.b2c?.count ?? 0)} />
            </Card.Content>
          </Card>

          {/* Advisories */}
          {advisories.length > 0 && (
            <Card style={styles.card}>
              <Card.Title title="Advisories" />
              <Card.Content>
                {advisories.map((adv, i) => (
                  <List.Item
                    key={i}
                    title={adv.type.replace(/_/g, ' ')}
                    description={adv.message ?? adv.recommendation ?? adv.mismatches?.[0]?.message}
                    left={props => <List.Icon {...props} icon={ADVISORY_ICONS[adv.type] ?? 'information'} />}
                    titleStyle={styles.advTitle}
                    descriptionNumberOfLines={4}
                  />
                ))}
              </Card.Content>
            </Card>
          )}

          {/* Validation errors */}
          {hasErrors && (
            <Card style={styles.card}>
              <Card.Title title="Invoices needing fixes" />
              <Card.Content>
                {invalidRecords.map((rec, i) => (
                  <View key={i} style={styles.errorRecord}>
                    <Text variant="titleSmall">{rec.record?.invoiceNo ?? `Invoice ${i + 1}`}</Text>
                    {rec.errors?.map((e, j) => (
                      <Text key={j} variant="bodySmall" style={styles.errorMsg}>• {e.message}</Text>
                    ))}
                  </View>
                ))}
              </Card.Content>
            </Card>
          )}
        </ScrollView>

        <View style={styles.actions}>
          <Button mode="outlined" onPress={() => onEdit(invalidRecords)} style={styles.actionBtn}>
            {hasErrors ? 'Fix invoices' : 'Edit'}
          </Button>
          <Button mode="contained" onPress={onApprove} disabled={hasErrors} style={styles.actionBtn}>
            Approve &amp; file
          </Button>
        </View>
      </Modal>
    </Portal>
  );
}

function Row({ label, value, bold }) {
  return (
    <View style={styles.row}>
      <Text variant="bodyMedium" style={bold && styles.bold}>{label}</Text>
      <Text variant="bodyMedium" style={bold && styles.bold}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  modal: { backgroundColor: 'white', margin: 16, borderRadius: 12, padding: 20, maxHeight: '88%' },
  title: { fontWeight: '600', marginBottom: 12 },
  scroll: { marginBottom: 12 },
  card: { marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  bold: { fontWeight: '700' },
  divider: { marginVertical: 6 },
  advTitle: { fontSize: 14, fontWeight: '500', textTransform: 'capitalize' },
  errorBanner: { backgroundColor: '#fce8e6', marginBottom: 12, borderRadius: 8 },
  errorRecord: { marginBottom: 12 },
  errorMsg: { color: '#c5221f', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 12 },
  actionBtn: { flex: 1 },
});
