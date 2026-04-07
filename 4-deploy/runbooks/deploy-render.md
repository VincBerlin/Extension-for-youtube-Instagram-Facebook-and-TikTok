# Runbook: Deploy Server to Render (Phase 4)

## Prerequisites

- Render account (free at render.com)
- GitHub repository with this code pushed
- Supabase project with schemas from migrations 001 + 002 applied

---

## 1. Create Web Service on Render

**Option A — via Dashboard:**

1. Go to render.com → **New** → **Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Name**: `resource-extractor-server`
   - **Root Directory**: `server`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
   - **Region**: Frankfurt (closest to EU users)

**Option B — via render.yaml:**

1. Copy `4-deploy/scripts/render.yaml` to the **repository root** as `render.yaml`
2. Render will auto-detect it on the next push

---

## 2. Set Environment Variables on Render

Go to your service → **Environment** → add these:

| Variable | Value |
|----------|-------|
| `AI_PROVIDER` | `gemini` |
| `GEMINI_API_KEY` | your key from aistudio.google.com |
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service role key |

**Do NOT set PORT** — Render sets it automatically.

---

## 3. Deploy and Verify

1. Push code to GitHub → Render deploys automatically
2. Wait for build to finish (2–3 minutes)
3. Health check:

```bash
curl https://your-service-name.onrender.com/health
# Expected: {"ok":true}
```

4. Note the deployed URL (e.g., `https://resource-extractor-server.onrender.com`)

---

## 4. Update Extension to Point to Live Server

1. Edit `extension/.env`:
   ```
   VITE_API_BASE=https://your-service-name.onrender.com
   ```
2. Rebuild the extension:
   ```bash
   cd extension && npm run build
   ```
3. Reload extension in Chrome (`chrome://extensions` → refresh icon)
4. Test extraction on a YouTube video — verify server log shows `[ai] provider=gemini`

---

## 5. Package Extension for GitHub Release

```bash
cd extension
npm run build

# Create zip from dist/
cd dist && zip -r ../resource-extractor-extension.zip . && cd ..
```

The resulting `resource-extractor-extension.zip` can be attached to a GitHub Release.

**Installation instructions for users:**
1. Download and unzip `resource-extractor-extension.zip`
2. Open `chrome://extensions` → Enable Developer mode
3. **Load unpacked** → select the unzipped folder
4. Click the Extension icon to open the Side Panel

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Build fails: "File not under rootDir" | Run `npm run build` locally in `server/` — check TypeScript errors |
| 502 errors on Render free tier | Free tier sleeps after 15 min inactivity — first request takes 30s |
| Supabase connection refused | Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Render env |
| CORS error in extension | Render is correctly configured with `cors({ origin: '*' })` — check URL in extension `.env` |
