---
name: google-drive-oauth
description: Build enterprise-grade Google Drive OAuth2 integrations for Node.js and Electron applications. Use this skill when implementing Google Drive file upload, folder browsing, or OAuth2 authentication flows. Ensures reliable, maintainable integrations that avoid common pitfalls.
---

This skill guides implementation of enterprise-quality Google Drive OAuth2 integrations for Node.js and Electron applications. Use the official `googleapis` library exclusively.

## Core Principles

### 1. Use OAuth2, Not API Keys for Drive Operations

Google Drive API with user data requires OAuth2. Never use API keys for Drive file operations.

**Required credentials (user-provided):**
- `client_id` - OAuth2 Client ID from Google Cloud Console
- `client_secret` - OAuth2 Client Secret

**Managed credentials (programmatic):**
- `refresh_token` - Stored after successful OAuth callback
- `root_folder_id` - Selected folder ID
- `root_folder_name` - Display name for UI

### 2. Dual-Mode OAuth Flow

Always support both popup and redirect modes for maximum compatibility:

```javascript
// Popup mode (default)
const popup = window.open(authUrl, 'oauth', 'width=600,height=700');

// Redirect mode (Shift+Click fallback)
if (event?.shiftKey) {
  sessionStorage.setItem('oauth_pending', 'true');
  window.location.href = authUrl;
}
```

**Why:** Popups may be blocked. Electron apps may not handle popups well. Mobile browsers prefer full redirects.

### 3. Server-Side Folder Browsing (Not Google Picker)

Never rely on Google Picker API for folder selection. Implement server-side folder listing:

```javascript
// Backend: GET /api/google-drive/folders?parentId=root
router.get('/folders', async (req, res) => {
  const parentId = req.query.parentId || 'root';
  const drive = buildDriveClient(clientId, clientSecret, refreshToken);
  
  const response = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    orderBy: 'name',
    pageSize: 200,
  });
  
  res.json({ folders: response.data.files || [] });
});
```

**Why:** Google Picker requires an API key, adds external JavaScript dependency, and its error modals are not dismissible.

### 4. Dismissible Error Modals

Every overlay/modal MUST have a close mechanism:

```html
<!-- Always include close button -->
<div class="modal-header">
  <h3>Title</h3>
  <button onclick="closeModal()" aria-label="Close">×</button>
</div>

<!-- Always handle Escape key -->
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

<!-- Always handle backdrop click -->
<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
```

### 5. CSRF Protection for OAuth

Generate one-time state tokens with expiration:

```javascript
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const _pendingStates = new Map();

function generateState() {
  const state = crypto.randomBytes(32).toString('hex');
  _pendingStates.set(state, Date.now() + STATE_TTL_MS);
  return state;
}

function consumeState(state) {
  const expiry = _pendingStates.get(state);
  if (!expiry) return false;
  _pendingStates.delete(state); // One-time use
  return Date.now() < expiry;
}
```

## Implementation Checklist

When implementing Google Drive integration:

- [ ] Use `googleapis` npm package (official Google library)
- [ ] Store only `client_id` and `client_secret` as user credentials
- [ ] Implement CSRF state tokens with 10-minute TTL
- [ ] Support both popup and redirect OAuth modes
- [ ] Implement server-side folder listing (no Picker API)
- [ ] All modals have close button, Escape key, and backdrop click
- [ ] Mask sensitive credentials in API responses
- [ ] Preserve programmatic fields on credential updates
- [ ] Handle token refresh errors gracefully
- [ ] Validate folder IDs against injection (alphanumeric + underscore/hyphen only)

## Common Pitfalls to Avoid

1. **Using Google Picker API** - Requires API key, external JS, non-dismissible errors
2. **Storing API keys for OAuth flows** - Not needed; OAuth2 uses client_id/secret
3. **Non-dismissible error modals** - Always provide escape mechanism
4. **Single OAuth mode** - Always support popup AND redirect
5. **Missing CSRF protection** - Always use one-time state tokens
6. **Client-side token storage** - Store refresh_token server-side only

## Testing Requirements

Every Google Drive integration must include:

1. **Unit tests** for all API endpoints (mock `googleapis`)
2. **E2E tests** for OAuth flow, folder selection, disconnect
3. **Error handling tests** for invalid states, expired tokens, network errors

## References

- [googleapis npm package](https://www.npmjs.com/package/googleapis)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Google Drive API v3 Reference](https://developers.google.com/drive/api/v3/reference)
