# Deploying LearnHarness Office (Ubuntu 22.04)

Host-specific values are placeholders (`<USER>`, model IDs, proxy URL). Never commit real values or proxy credentials.

## 1. Prerequisites
- Node.js 20+ and npm, git, Docker (for SearXNG).
- The Gemma 4 proxy must already be running at `http://127.0.0.1:8088/v1` (managed separately on this host).
  Run the copy in `deploy/gemma4-proxy/gemma4_proxy.py`: it honors each request's `chat_template_kwargs.enable_thinking`, which LearnHarness sends from each user's Reasoning preference (Preferences page, default on). The older proxy ignores it and uses only its `THINKING` variable (default off), so the switch has no effect until this copy replaces it. `THINKING` remains the default for requests that do not send the field. Start it the same way: `UPSTREAM=http://172.20.1.126:1234 TEMPLATE=./gemma4_chat_template.jinja uvicorn gemma4_proxy:app --host 127.0.0.1 --port 8088`.

## 2. Get the code
```bash
git clone <REPO_URL> ~/app && cd ~/app && git checkout office
npm ci && npm run build && npm run build:source
```

## 3. Environment
```bash
cp .env.example .env && chmod 600 .env
openssl rand -hex 32   # paste as SESSION_SECRET
```
Fill the placeholders in `.env`: `LLM_MODEL`, `LLM_CONTEXT_WINDOW`, `LLM_MAX_TOKENS` (smaller than the window), `LLM_VISION`, `LLM_REASONING`, and `VISION_BASE_URL`/`VISION_MODEL` if used. `LLM_CONTEXT_WINDOW` must match the model's real context (for Ollama, its `num_ctx`) and should be at least 32768: compaction starts at the window minus a 16,384-token reserve, so a 16k window compacts before every turn. Set `HTTPS_PROXY` (URL-encode special characters) only on the host. Optionally set `KNOWLEDGE_SHARED_DIR` (directory of shared documents) and `KNOWLEDGE_INDEX_FILE` (output index path), then run `npm run index:shared`. Left empty, shared knowledge is off and only personal uploads work.

## 4. Data directory
`data/` lives in the app folder and is created by the service user:
```bash
mkdir -p ~/app/data && chmod 700 ~/app/data
```

## 5. SearXNG (web search)
```bash
mkdir -p ~/searxng && cd ~/searxng
cat > settings.yml <<'YML'
use_default_settings: true
server:
  secret_key: "<RANDOM_HEX>"   # openssl rand -hex 32
  limiter: false
search:
  formats: [html, json]
# Optionally restrict `engines:` to ones confirmed reachable from this host.
YML
docker run -d --name searxng --restart no -p 127.0.0.1:8080:8080 \
  -v ~/searxng:/etc/searxng searxng/searxng
curl 'http://127.0.0.1:8080/search?q=test&format=json' | head -c 300
```

## 6. systemd service
```bash
sed 's/<USER>/'"$USER"'/g' deploy/learnharness.service | sudo tee /etc/systemd/system/learnharness.service
sudo systemctl daemon-reload && sudo systemctl start learnharness
journalctl -u learnharness -f      # logs
```
Manual start only: neither the app nor SearXNG starts at boot, and a crash stays down until you start it again (`deploy/start.sh`, `deploy/searxng.sh start`).
If an older install enabled it, `start.sh` disables boot start; or run `sudo systemctl disable learnharness` and `docker update --restart no searxng` once.

## Helper scripts (check first, confirm before changing)
```bash
deploy/start.sh      # checks env/build/port, installs the unit if missing, starts the app
deploy/stop.sh       # stops the app (start again with start.sh)
deploy/remove.sh     # stops, disables and deletes the unit; keeps code, data/, .env
deploy/searxng.sh start|stop|remove   # the 'searxng' container only; keeps image and ~/searxng
```
They only touch the `learnharness` service and the `searxng` container, and ask y/N before each change.

## 7. Upgrade
```bash
cd ~/app && git pull && npm ci && npm run build && npm run build:source
sudo systemctl restart learnharness
```

## 8. Acceptance checks
```bash
npm run smoke:llm
curl -s -X POST localhost:3000/api/auth/signup -H 'content-type: application/json' -d '{"username":"probe","password":"<PASSWORD>"}'
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/chats     # expect 401 when logged out
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/source        # expect 200 (AGPL source archive)
tar tzf dist/source.tar.gz | grep -E '\.env$|^learnharness/data/'      # expect no output
grep -rIl -e "$(grep ^SESSION_SECRET .env | cut -d= -f2)" .next || echo "no secrets in .next"
```
Also verify in the UI: Web toggle works, live search returns cited URLs, Web + Knowledge ON pauses for Allow/Deny, and observe outbound connections are only the LLM endpoint, the proxy and SearXNG.

## Not done yet
- Shared knowledge (set paths later; see `.env.example`).
