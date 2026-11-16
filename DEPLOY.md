# Deploying LearnHarness Office (Ubuntu 22.04)

Host-specific values are placeholders (`<USER>`, model IDs, proxy URL). Never commit real values or proxy credentials.

## 1. Prerequisites
- Node.js 20+ and npm, git, Docker (for SearXNG).
- The Gemma 4 proxy must already be running at `http://127.0.0.1:8088/v1` (managed separately on this host).

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
Fill the placeholders in `.env`: `LLM_MODEL`, `LLM_CONTEXT_WINDOW`, `LLM_MAX_TOKENS` (smaller than the window), `LLM_VISION`, `LLM_REASONING`, and `VISION_BASE_URL`/`VISION_MODEL` if used. Set `HTTPS_PROXY` (URL-encode special characters) only on the host. Set `LH_ADMIN_USERNAME` to the username of the admin account (see Administration below). Optionally set `KNOWLEDGE_SHARED_DIR` (directory of shared documents) and `KNOWLEDGE_INDEX_FILE` (output index path), then run `npm run index:shared` to add an admin-built folder index. Without them, users still share documents by uploading to the Shared pool on the Knowledge page.

### Pictures in PowerPoint files
Pictures placed on PPTX slides are described by a vision model and indexed as text under their slide, both for chat attachments and saved knowledge. The model is `VISION_BASE_URL` + `VISION_MODEL` when both are set, otherwise the main model when `LLM_VISION=true`; with neither, decks are read as text only. Up to 30 unique pictures per file are described (template art and duplicates are skipped), each call sharing the background model limit so chats stay responsive. A picture that cannot be read never fails the upload: the slide text is kept and the user sees a note naming the slides. Check that the model accepts images before relying on it (LM Studio needs Gemma 4's vision projector loaded, and the proxy must pass images through):
```bash
IMG=$(base64 -w0 some-small.png)
curl -s http://127.0.0.1:8088/v1/chat/completions -H 'content-type: application/json'   -d '{"model":"<LLM_MODEL>","max_tokens":200,"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,'"$IMG"'"}},{"type":"text","text":"Describe this image."}]}]}' | head -c 600
```
A description in `choices[0].message.content` means pictures will work. Decks uploaded before vision was on keep their text-only index; upload them again to add picture descriptions.

### Administration
There is no admin role stored in accounts: the admin is whichever account's username exactly equals `LH_ADMIN_USERNAME` (whitespace trimmed). Left empty, there is no admin. Because signup is open, **sign up that username yourself right after the first start**, before anyone else can claim it. Changing the variable (and restarting) moves admin rights to another existing account.

The admin can:
- open `/admin` to list users, reset a user's password, and delete users. There is no email reset; the login page tells users to contact their administrator. The admin account itself cannot be deleted, and deleting a user removes only the account, not their data under `data/users/`.
- open `/admin/knowledge` for shared-library stats: item and chunk totals, uploads per day, and who uploaded each document.
- see the Shared activity list on the Knowledge page (every shared add and delete, from `data/shared/knowledge/audit.jsonl`).

Shared uploads live in `data/shared/`. Any signed-in user can upload to or delete from the Shared pool; every add and delete is logged.

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
- No sidebar link to `/admin`; open it by URL.
