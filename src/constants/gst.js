// src/constants/gst.js
// Central reference data - no network required, all on-device

export const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];

export const FILING_TYPES = {
  GSTR1: {
    id: 'GSTR1',
    label: 'GSTR-1',
    description: 'Outward supplies (Sales)',
    dueDates: { monthly: 11, quarterly: 13 },
    sections: ['B2B', 'B2C_LARGE', 'B2C_SMALL', 'CDNR', 'EXP', 'NIL'],
  },
  GSTR3B: {
    id: 'GSTR3B',
    label: 'GSTR-3B',
    description: 'Monthly self-assessed summary',
    dueDates: { monthly: 20 },
    sections: ['3_1', '3_2', '4', '5', '5_1', '6_1'],
  },
  CMP08: {
    id: 'CMP08',
    label: 'CMP-08',
    description: 'Composition taxpayer quarterly statement',
    dueDates: { quarterly: 18 },
    sections: ['OUTWARD', 'INWARD_RCM'],
  },
};

export const TURNOVER_TIERS = {
  MICRO: { max: 4000000, label: 'Micro (< ₹40L)', filing: 'quarterly' },
  SMALL: { max: 15000000, label: 'Small (₹40L–₹1.5Cr)', filing: 'monthly' },
  MEDIUM: { max: null, label: 'Medium (> ₹1.5Cr)', filing: 'monthly' },
};

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

export const STATE_CODES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
  '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory', '99': 'Centre Jurisdiction',
};

export const DOCUMENT_TYPES = {
  TAX_INVOICE: 'Tax Invoice',
  BILL_OF_SUPPLY: 'Bill of Supply',
  CREDIT_NOTE: 'Credit Note',
  DEBIT_NOTE: 'Debit Note',
  RECEIPT_VOUCHER: 'Receipt Voucher',
  PAYMENT_VOUCHER: 'Payment Voucher',
};

export const OCR_CONFIDENCE_THRESHOLD = 0.85;
export const MAX_UPLOAD_RETRIES = 3;
export const MAX_FILING_RETRIES = 3;
export const BATCH_SIZE = 50;

export const GDRIVE_FOLDER_NAME = 'GST Filing Agent';
export const GDRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
];
