# Google Drive OAuth2 Integration - Implementation Guide

## Overview

This document describes the complete Google Drive OAuth2 integration implementation in Frog Automation, including the refactored dual-mode authentication flow, state management, and testing strategy.

## Architecture

### Authentication Flow

The integration supports **two authentication modes**:

1. **Popup Mode (Default)**: Opens OAuth consent in a popup window, uses `postMessage` for callback
2. **Redirect Mode (Shift+Click)**: Full-page redirect to OAuth, uses `sessionStorage` + URL params for state

```
User clicks "Connect"
    ↓
Frontend: GET /api/google-drive/auth-url
    ↓
Backend: Generate CSRF state token + OAuth URL
    ↓
Frontend: Open OAuth (popup or redirect)
    ↓
User authorizes on Google
    ↓
Google redirects to: /api/google-drive/callback?code=...&state=...
    ↓
Backend: Validate state, exchange code for tokens, store refresh_token
    ↓
Callback page: Send result to opener (popup) OR store in sessionStorage (redirect)
    ↓
Frontend: Update connection status UI
```

### Key Components

#### Backend Routes (`src/routes/google-drive.js`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/google-drive/status` | GET | Get connection status & root folder |
| `/api/google-drive/auth-url` | GET | Generate OAuth consent URL with CSRF state |
| `/api/google-drive/callback` | GET | OAuth redirect target; exchanges code for tokens |
| `/api/google-drive/folders` | GET | List folders via Drive API (replaces Picker) |
| `/api/google-drive/root-folder` | POST | Store selected folder from folder browser |
| `/api/google-drive/auth` | DELETE | Disconnect (clear tokens, preserve credentials) |

#### Frontend Functions (`public/index.html`)

| Function | Purpose |
|----------|---------|
| `connectGoogleDrive(event)` | Start OAuth flow (popup or redirect based on Shift key) |
| `_onDriveAuthMessage(event)` | Handle postMessage from popup callback |
| `_pollPopupClosed(popup)` | Detect manual popup closure |
| `_showDriveMessage(text, type)` | Show status message with color |
| `_checkDriveAuthRedirect()` | Check for OAuth return via redirect (on page load) |
| `loadDriveStatus()` | Fetch and apply connection status |
| `disconnectGoogleDrive()` | Clear OAuth tokens |
| `openDriveFolderBrowser()` | Open custom folder browser modal |
| `closeDriveFolderBrowser()` | Close folder browser modal |
| `_loadDriveFolders(parentId)` | Load folders from Drive API |
| `confirmDriveFolder()` | Save selected folder to server |

## Dual-Mode OAuth Implementation

### Popup Mode (Default)

**When to use:** Normal browser environment with popups enabled

**Flow:**
1. User clicks "Connect Google Drive"
2. Opens 600×700 popup window with OAuth consent screen
3. User authorizes → Google redirects to `/api/google-drive/callback`
4. Callback page sends `postMessage` to opener window
5. Opener receives message, updates UI, closes popup
6. Frontend polls popup.closed to detect manual closure

**Advantages:**
- User stays on main page
- No navigation interruption
- Works well for single-page apps

**Code Example:**
```javascript
const popup = window.open(authUrl, 'gd-auth', 'width=600,height=700,...');
window.addEventListener('message', _onDriveAuthMessage, { once: true });
```

### Redirect Mode (Shift+Click)

**When to use:** Popups blocked, Electron app, mobile browsers, or user preference

**Flow:**
1. User holds Shift and clicks "Connect Google Drive"
2. Full page redirects to OAuth consent screen
3. User authorizes → Google redirects to `/api/google-drive/callback`
4. Callback page stores result in `sessionStorage`
5. Auto-redirect to `/?gdrive_auth=success` after 1.5 seconds
6. Frontend detects return, reads `sessionStorage`, shows result

**Advantages:**
- Works when popups blocked
- More reliable in some environments (Electron, mobile)
- Better for users who prefer full-screen flows

**Code Example:**
```javascript
if (event?.shiftKey) {
  sessionStorage.setItem('gdrive_auth_pending', 'true');
  window.location.href = authUrl; // Full-page redirect
}
```

## State Management

### CSRF Protection

```javascript
// Backend: Generate one-time state token (10-minute TTL)
const state = crypto.randomBytes(32).toString('hex');
_pendingStates.set(state, Date.now() + STATE_TTL_MS);

// Backend: Validate and consume (one-time use)
function _consumeState(state) {
  const expiry = _pendingStates.get(state);
  if (!expiry) return false;
  _pendingStates.delete(state); // One-time use
  return Date.now() < expiry;
}
```

### OAuth Result Persistence

**Popup Mode:**
```javascript
// Callback page (inside popup)
window.opener.postMessage({ type: 'drive-auth-success' }, window.location.origin);
window.close();
```

**Redirect Mode:**
```javascript
// Callback page (full-page)
sessionStorage.setItem('gdrive_auth_result', JSON.stringify({
  type: 'drive-auth-success'
}));
window.location.href = '/?gdrive_auth=success';

// Main page on load
const result = sessionStorage.getItem('gdrive_auth_result');
if (result) {
  const msg = JSON.parse(result);
  _showDriveMessage('✓ Connected successfully!', 'success');
  sessionStorage.removeItem('gdrive_auth_result');
}
```

## Error Handling

### Frontend Error Detection

1. **Popup Blocked:**
   ```javascript
   const popup = window.open(url, ...);
   if (!popup) {
     _showDriveMessage('Popup blocked. Try Shift+Click for redirect mode.', 'error');
   }
   ```

2. **Manual Popup Closure:**
   ```javascript
   function _pollPopupClosed(popup) {
     const interval = setInterval(() => {
       if (popup.closed) {
         clearInterval(interval);
         loadDriveStatus(); // Refresh status
       }
     }, 500);
   }
   ```

3. **OAuth Cancellation (Redirect Mode):**
   ```javascript
   if (sessionStorage.getItem('gdrive_auth_pending')) {
     _showDriveMessage('Authorization was canceled', 'error');
   }
   ```

### Backend Error Responses

All callback errors return HTML page with styled error message:

```javascript
callbackResponse(res, 'drive-auth-error', {
  error: 'Invalid or expired state parameter'
});
```

Results in:
```html
<div class="icon error">✕</div>
<h1>Authorization Failed</h1>
<p>Invalid or expired state parameter</p>
<a href="/" class="btn">Return to Application</a>
```

## Security Considerations

### XSS Prevention

Error messages are escaped in callback HTML:

```javascript
const payload = JSON.stringify({ type, ...extra })
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026');
```

### CSRF Protection

- Random 32-byte state token per auth request
- 10-minute expiration
- One-time use (deleted after validation)
- In-memory storage with periodic cleanup

### Credential Separation

- User-editable: `client_id`, `client_secret`
- Programmatic-only: `refresh_token`, `root_folder_id`, `root_folder_name`
- Sensitive fields masked in API responses

## Testing Strategy

### Unit Tests (`tests/routes/google-drive-oauth.test.js`)

Covers all OAuth endpoints with mocked `googleapis`:

```javascript
- Callback error handling (error param, missing code, invalid state)
- CSRF state validation (one-time use, expiration)
- Token exchange (new refresh_token, re-auth without new token)
- Token endpoint (fresh token, refresh errors, 401 when not authenticated)
```

**All 51 Google Drive tests pass ✅**

### Integration Tests

Via `tests/routes/google-drive.test.js`:
- Status endpoint with various credential states
- Auth URL generation
- Root folder storage
- Disconnect (token clearing while preserving credentials)

### E2E Tests (`tests/e2e/ui.spec.js`)

8 comprehensive Playwright tests covering:

```javascript
✓ Google Drive card shows correct initial state
✓ Google Drive card shows credential fields
✓ Save button stores credentials (validates via API)
✓ Connect button shows error when credentials missing
✓ Connect button detects popup blocker
✓ Toggle enable/disable updates status
✓ Shift+Click hint shown in documentation
✓ Disconnect button clears connection status
```

**Run E2E tests:** `npm run test:e2e`
**Note:** Requires `npx playwright install` first

## User Experience

### Status Indicators

The connection status uses color-coded messages:

- **Green**: Success states ("● Connected", "✓ Connected successfully!")
- **Red**: Error states ("Authorization failed:", "Popup blocked")
- **Blue**: Info states ("Redirecting to Google...", "Authorize in popup...")
- **Gray**: Neutral states ("○ Not connected")

### Visual Feedback

The callback page provides professional feedback:

```
[Loading]
  ⟳ Spinner animation
  "Completing authorization..."

[Success]
  ✓ Green checkmark
  "Authorization Successful"
  "Redirecting..." → auto-redirect after 1.5s

[Error]
  ✕ Red X
  "Authorization Failed"
  [Error message]
  [Return to Application] button
```

### Progressive Disclosure

1. **Initial State**: Show "Not connected", disabled folder picker
2. **Credentials Entered**: Enable "Connect" button
3. **Connected**: Show green status, enable folder picker, show disconnect button
4. **Folder Selected**: Display folder name with icon

## Setup Instructions for Developers

### Google Cloud Console Setup

1. Create project at https://console.cloud.google.com/
2. Enable APIs:
   - Google Drive API
3. Create OAuth 2.0 Client ID (Web application)
4. Configure authorized origins:
   - Add: `http://localhost:3000` (or your server URL)
5. Configure authorized redirect URIs:
   - Add: `http://localhost:3000/api/google-drive/callback`

### Application Setup

1. Start the app: `npm start`
2. Navigate to API Integrations section
3. Enter credentials:
   - OAuth2 Client ID
   - OAuth2 Client Secret
4. Click "Save"
5. Click "Connect Google Drive" (or Shift+Click for redirect mode)
6. Authorize in Google consent screen
7. Select root folder for uploads using the folder browser

## Troubleshooting

### "Popup blocked" Error

**Cause:** Browser blocking popup windows
**Solution:** Hold Shift while clicking "Connect Google Drive" to use redirect mode

### "Google did not return a refresh token"

**Cause:** Re-authorizing when existing grant is valid
**Solution:** Click "Disconnect" first, then "Connect" again

### "Invalid or expired state parameter"

**Cause:** CSRF state token expired (>10 minutes) or already used
**Solution:** Click "Connect" again to generate fresh state token

### OAuth Callback Opens in New Tab (Not Popup)

**Cause:** Browser settings or popup blocker
**Solution:** Use Shift+Click for redirect mode instead

## Future Enhancements

Potential improvements for future iterations:

1. **Persistent OAuth Session:** Store encrypted refresh_token with longer expiry
2. **Upload Progress:** Real-time progress bar during Drive uploads
3. **Batch Uploads:** Upload multiple completed jobs at once
4. **OAuth Refresh:** Auto-refresh expired tokens transparently
5. **Multi-Account Support:** Connect multiple Google accounts
6. **Webhook Integration:** Real-time upload notifications

## References

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Google Drive API v3 Reference](https://developers.google.com/drive/api/v3/reference)
- [Playwright Testing Documentation](https://playwright.dev/)

---

**Last Updated:** 2026-03-19
**Version:** 2.0.0
**Author:** Claude Opus 4.5

### Changelog v2.0.0 (2026-03-19)

- Removed Google API Key (no longer required for OAuth2 flow)
- Removed Google Picker API dependency
- Added custom folder browser modal with full keyboard support
- Added `/api/google-drive/folders` endpoint for server-side folder listing
- All modals now have close/dismiss buttons (enterprise UX requirement)
