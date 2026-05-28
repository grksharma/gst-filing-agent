// src/services/googleDriveService.js
// Wraps Google Drive REST API v3.
// Uses the user's own Google account — app only gets drive.file scope
// (can only see files it creates, never the user's other files).

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import { GDRIVE_SCOPES } from '../constants/gst';

WebBrowser.maybeCompleteAuthSession();

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'gdrive_access_token';
const REFRESH_KEY = 'gdrive_refresh_token';
const EXPIRY_KEY = 'gdrive_token_expiry';

// ─────────────────────────────────────────────
// OAuth2 flow
// ─────────────────────────────────────────────

export function buildAuthRequest(clientId) {
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'gstfilingagent' });
  const discovery = {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  };
  const request = new AuthSession.AuthRequest({
    clientId,
    scopes: GDRIVE_SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });
  return { request, redirectUri, discovery };
}

export async function exchangeCodeForTokens(code, redirectUri, clientId) {
  const res = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const { access_token, refresh_token, expires_in } = res.data;
  await storeTokens(access_token, refresh_token, expires_in);
  return access_token;
}

async function storeTokens(access, refresh, expiresIn) {
  await SecureStore.setItemAsync(TOKEN_KEY, access);
  if (refresh) await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  await SecureStore.setItemAsync(EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
}

export async function getValidAccessToken(clientId) {
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  const expiry = await SecureStore.getItemAsync(EXPIRY_KEY).catch(() => null);
  if (token && expiry && Date.now() < parseInt(expiry) - 60000) return token;

  // Refresh
  const refresh = await SecureStore.getItemAsync(REFRESH_KEY).catch(() => null);
  if (!refresh) return null;

  try {
    const res = await axios.post('https://oauth2.googleapis.com/token', {
      refresh_token: refresh,
      client_id: clientId,
      grant_type: 'refresh_token',
    });
    const { access_token, expires_in } = res.data;
    await storeTokens(access_token, refresh, expires_in);
    return access_token;
  } catch {
    return null;
  }
}

export async function revokeGDriveAccess() {
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (token) await axios.post(`https://oauth2.googleapis.com/revoke?token=${token}`).catch(() => {});
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(EXPIRY_KEY).catch(() => {});
}

// ─────────────────────────────────────────────
// Drive operations
// ─────────────────────────────────────────────

export function getDriveService(accessToken) {
  const headers = () => ({ Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' });

  return {
    /**
     * Get or create the app's root folder in Drive.
     */
    async getOrCreateFolder(name) {
      const search = await axios.get(`${DRIVE_API}/files`, {
        headers: headers(),
        params: {
          q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id,name)',
          spaces: 'drive',
        },
      });
      if (search.data.files?.length) return search.data.files[0];

      const create = await axios.post(`${DRIVE_API}/files`, {
        name,
        mimeType: 'application/vnd.google-apps.folder',
      }, { headers: headers() });
      return create.data;
    },

    /**
     * Upload a file to Drive. Uses multipart upload for small files.
     */
    async uploadFile({ name, mimeType, content, parentId }) {
      const metadata = { name, mimeType, ...(parentId ? { parents: [parentId] } : {}) };
      const boundary = 'boundary_gst_agent';
      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        `Content-Type: ${mimeType}`,
        '',
        typeof content === 'string' ? content : JSON.stringify(content),
        `--${boundary}--`,
      ].join('\r\n');

      const res = await axios.post(`${UPLOAD_API}/files?uploadType=multipart`, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
      });
      return res.data.id;
    },

    /**
     * List all GST filing records in the app folder.
     */
    async listFilings(folderId) {
      const res = await axios.get(`${DRIVE_API}/files`, {
        headers: headers(),
        params: {
          q: `'${folderId}' in parents and trashed=false`,
          fields: 'files(id,name,createdTime,size)',
          orderBy: 'createdTime desc',
        },
      });
      return res.data.files ?? [];
    },

    /**
     * Read a file's content from Drive.
     */
    async readFile(fileId) {
      const res = await axios.get(`${DRIVE_API}/files/${fileId}?alt=media`, {
        headers: headers(),
        responseType: 'text',
      });
      return res.data;
    },

    /**
     * Delete a file from Drive.
     */
    async deleteFile(fileId) {
      await axios.delete(`${DRIVE_API}/files/${fileId}`, { headers: headers() });
    },
  };
}
