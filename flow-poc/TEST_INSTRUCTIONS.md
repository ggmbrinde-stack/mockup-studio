# Phase 2 Validation — Test Instructions

## Prerequisites
- Chrome installed
- Illustrator with Mockup Studio panel installed
- Node.js v18+
- Admin rights (for native messaging host registration)

## Step 1: Install Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select folder: `C:\Users\user\Videos\BestOfGifts_Master\repos\mockup-studio\flow-poc\extension`
5. Copy the **Extension ID** (32-char string like `abcdefghijklmnopqrstuvwxyz123456`)

## Step 2: Update Native Messaging Manifest

```powershell
# Run in PowerShell (replace EXTENSION_ID with actual ID)
cd C:\Users\user\Videos\BestOfGifts_Master\repos\mockup-studio\flow-poc
.\update-extension-id.ps1 -ExtensionId "YOUR_EXTENSION_ID_HERE"
```

## Step 3: Restart Chrome

Close ALL Chrome windows and restart.

## Step 4: Start Native Host (for testing)

```powershell
cd C:\Users\user\Videos\BestOfGifts_Master\repos\mockup-studio\flow-poc\agent
node flow-bridge.js
```

Keep this terminal open — it shows logs.

## Step 5: Start UI Dev Server

```powershell
cd C:\Users\user\Videos\BestOfGifts_Master\repos\mockup-studio\flow-poc\ui
npm run dev
```

Open `http://localhost:5173` in Chrome.

## Step 6: Test Generation Workflow

1. Open Illustrator with a document
2. Draw/select some artwork (or leave empty for pure generation)
3. In PoC UI:
   - Tool: **Image Generation**
   - Model: **Nano Banana 2.1 (Default)**
   - Prompt: `A simple red circle on white background, minimal vector style`
   - Click **Start Generation**
4. Flow opens in new tab — sign in if needed
5. **Manual steps in Flow**:
   - (Optional) Upload exported reference images
   - Paste/enter prompt
   - Select model
   - Click **Generate**
   - Wait for result
   - Click **Download** (saves to `~/Downloads/MockupStudioFlow/`)
6. PoC UI should detect download → show preview
7. Click **Place in Illustrator** → image appears on "Flow Result" layer

## Step 7: Test Upscaling Workflow

1. In Illustrator, select a placed/raster image
2. In PoC UI:
   - Tool: **Image Upscaling**
   - Click **Start Upscaling**
3. Flow opens — upload the exported image
4. Choose upscale settings, generate, download
5. PoC detects → preview → **Place in Illustrator** → appears on "Flow Upscaled" layer

## Expected Results

| Test | Pass Criteria |
|------|---------------|
| Extension installs | No errors in `chrome://extensions` |
| Native host connects | Terminal shows `{"type":"ready"}` |
| UI loads | `http://localhost:5173` shows PoC panel |
| Generation export | Status shows "exporting" → "waiting" |
| Flow opens | New tab with `flow.google.com` |
| Download detected | Status changes to "complete", preview appears |
| Import to Illustrator | Image placed on named layer |
| Upscaling export | Same flow, different layer name |
| No auto automation | User manually clicks Generate/Download in Flow |

## Verification Checklist

- [ ] Extension ID updated in manifest
- [ ] Chrome restarted after manifest change
- [ ] Native host terminal shows `extensionReady` message
- [ ] PoC UI shows "Extension: <ID>" and "Native Host: Connected"
- [ ] Export runs without Illustrator errors
- [ ] Flow generates image successfully
- [ ] Download appears in `~/Downloads/MockupStudioFlow/`
- [ ] PoC detects download within 5 seconds
- [ ] Preview renders correctly
- [ ] Place in Illustrator works for both tools
- [ ] No credentials stored anywhere
- [ ] No Flow DOM manipulation in extension
- [ ] Production Mockup Studio panel still works

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Native host not connected" | Restart Chrome, check manifest Extension ID |
| Download not detected | Check `~/Downloads/MockupStudioFlow/` exists; check native host logs |
| Import fails | Verify `flow-import.jsx` is in host folder; check Illustrator console |
| Flow doesn't open | Check popup blocker; try `window.open` fallback |
| Status file not found | Check `Documents/VectorizerBridge/flow-status/` permissions |

## Security Validation

Confirm during testing:
- [ ] No Google cookies/tokens accessed
- [ ] No Flow page content scripts running
- [ ] User manually clicks Generate in Flow
- [ ] User manually clicks Download in Flow
- [ ] Extension only observes `chrome.downloads` API
- [ ] Job ID association works without filename dependency
- [ ] No recurring download attempts on failure