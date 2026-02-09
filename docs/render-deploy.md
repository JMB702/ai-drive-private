# Fastest Always-On Deploy (No VM Setup)

If you don't want to manage a VM/IP, deploy with Render using the included Blueprint (`render.yaml`).

## What you need
- A GitHub repo containing this project
- A Render account

## Steps (quick)
1. Push this project to GitHub.
2. In Render, click **New +** -> **Blueprint**.
3. Select your repo and confirm `render.yaml`.
4. Set required env vars in Render:
   - `APP_ACCESS_USERNAME`
   - `APP_ACCESS_PASSWORD`
   - provider keys you use (`GEMINI_API_KEY`, etc.)
5. Deploy.

## Why this works for your requirement
- Service runs on Render infrastructure (online when your laptop is off).
- Persistent disk mounted at `/data` keeps generated assets and previews across restarts.
- Your app-level sign-in gate stays enabled, so the app is private unless credentials are shared.

## Cutover safety
- Keep your current local+tunnel URL running while Render deploys.
- After Render URL is verified (login works, images persist after restart), switch to that URL.
- Then you can shut down local setup.

