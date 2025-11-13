# Family Feud Angular SPA

This project is an Angular single-page application for running a Family Feud game. It features:
- Admin dashboard: Control questions, answers, percentages, scores, and navigation to next question.
- Presentation page: Display current question, options, percentages, and team scores.

## Getting Started

### Development server
Run `npm start` or `npm run dev` in the `familyfeud` directory for a dev server. Navigate to `http://localhost:4200/` or the port shown in the terminal. The app will automatically reload if you change any source files.

### Build
Run `npm run build` to build the project for production. The build artifacts will be stored in the `dist/` directory.

## Project Structure
- `src/app/admin` — Admin dashboard components
- `src/app/presentation` — Presentation page components
- `src/app/services` — Shared game state and logic

## Customization
Edit questions, answers, and team names in the admin dashboard. The presentation page updates automatically.

---
For more details, see the Angular documentation: https://angular.dev/

## AI-assisted Survey Clustering (optional)

You can enable AI to auto-cluster free-text survey answers and produce a consolidated sheet for review.

Server supports both OpenAI and Azure OpenAI. Set ONE of the following configurations as environment variables when starting the server (the Angular app is unchanged):

- OpenAI
	- `OPENAI_API_KEY` — your OpenAI API key
	- `OPENAI_BASE_URL` — optional, defaults to `https://api.openai.com`
	- `OPENAI_MODEL` — optional, defaults to `gpt-4o-mini`

- Azure OpenAI
	- `AI_PROVIDER=azure`
	- `AZURE_OPENAI_API_KEY`
	- `AZURE_OPENAI_ENDPOINT` — e.g. `https://your-resource.openai.azure.com`
	- `AZURE_OPENAI_DEPLOYMENT` — your chat deployment name
	- `AZURE_OPENAI_API_VERSION` — e.g. `2024-02-15-preview`

Usage:
1) Start survey and collect responses.
2) In Admin → Survey Review: choose the question index, click “Load”.
3) Optionally add synonyms (from => to) and click “Save Synonyms”.
4) Click “AI Cluster” to request an AI-generated grouping. You can still adjust labels/merge and export.

Note: If AI is not configured or unreachable, the Admin will fall back to local clustering.

## Deploy on Render (Free Web Service)

This app bundles the Angular UI and a Node server (Express + WebSocket) into a single service. Render’s free Web Service can host both.

We’ve included a `render.yaml` so you can deploy with one click from the Render Dashboard (Blueprint) or by connecting your GitHub repo.

What it does
- Builds Angular: `ng build` → outputs to `dist/familyfeud/browser`
- Installs server deps: `npm install --prefix server`
- Starts server: `node server/index.js` (listens on `PORT` set by Render)
- Health check: `/api/ping`

Steps
1) Push this repo to GitHub.
2) In Render, click “New +” → “Blueprint” → pick your repo with `render.yaml` at the project root.
3) Keep the free plan, review the build and start commands.
4) Add environment variables if needed (e.g., `OPENAI_API_KEY`).
5) Deploy. When live, open the URL; server serves the UI and APIs on the same origin.

Notes
- WebSockets are supported on Render; no changes needed.
- If you see build issues with server deps, Render uses the provided commands to install. We use `npm install --prefix server` in the build step.
- You can change the service name or Node version in `render.yaml`.

## Deploy with Docker

We include a multi-stage Dockerfile that builds the Angular app and runs the Node server serving the UI and APIs (including WebSockets).

Build and run locally
```powershell
docker build -t familyfeud .
docker run --rm -p 3001:3001 -e PORT=3001 familyfeud
# Open http://localhost:3001
```

Environment variables (optional; set with -e KEY=VALUE)
- OPENAI_API_KEY (or Azure equivalents) for AI clustering
- NODE_ENV=production (default)

### Fly.io (optional)
We also include a `fly.toml` for Fly.io. After installing the Fly CLI:
```powershell
fly launch --no-deploy
fly deploy
```
This uses the Dockerfile to build and deploy. WebSockets are supported.

### Koyeb / Cloud Run
- Koyeb: create a new service from your GitHub repo; it will detect the Dockerfile.
- Cloud Run: `gcloud builds submit --tag gcr.io/PROJECT/familyfeud` then `gcloud run deploy --image gcr.io/PROJECT/familyfeud --platform managed`.

