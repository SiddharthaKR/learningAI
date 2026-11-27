# Deploying LearnHarness Office (Ubuntu 22.04)

Host-specific values are placeholders (`<USER>`, model IDs, proxy URL). Never commit real values or proxy credentials.

## 1. Prerequisites
- Node.js 20+ and npm, git, Docker (for SearXNG).
- The Gemma 4 proxy must be running at `http://127.0.0.1:8088/v1`, in front of LM Studio (`:1234`). Use the version in `deploy/gemma4-proxy/` (see below).

### The Gemma 4 proxy (`deploy/gemma4-proxy/gemma4_proxy.py`)
One proxy serves every client on the host (LearnHarness, opencode, …). It replaces the earlier `gemma4_proxy.py`; start it exactly as before:
```bash
cd ~/app/deploy/gemma4-proxy
UPSTREAM=http://172.20.1.126:1234 TEMPLATE=./gemma4_chat_template.jinja \
  uvicorn gemma4_proxy:app --host 127.0.0.1 --port 8088
```
What changed, and the switches (environment variables):
- **Streaming:** `stream=true` requests now get text and thinking **as the model writes them** (before, nothing arrived until the whole reply was finished). Tool calls are sent once complete and parsed exactly as before. `STREAM=0` restores the old behaviour.
- `stream=false` requests are answered exactly as before.
- Tool names may contain `:` (Gemma sometimes writes `call:default:probe{…}`; before, that call leaked into the reply as text).
- **Per-request thinking:** a request's `chat_template_kwargs.enable_thinking` (true/false) overrides `THINKING`. LearnHarness sends it on every call from each user's Reasoning switch (Preferences page, default on), so with this proxy reasoning follows that switch.
- `JSON_TOOL_CALLS=1` (off by default) also accepts a tool call written as a ```json block. LearnHarness does not need it (the app handles this itself); leave it off unless another client wants it.

Check after switching: opencode still edits files (tool calls work), and in LearnHarness the reply text appears while it is being written. Tests (no LM Studio needed): `uv run --with fastapi --with httpx --with jinja2 python -m unittest discover -s tests` in `deploy/gemma4-proxy`; they compare every answer with the previous proxy (`tests/legacy_proxy.py`).

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
Fill the placeholders in `.env`: `LLM_MODEL`, `LLM_CONTEXT_WINDOW`, `LLM_MAX_TOKENS` (smaller than the window), `LLM_VISION`, `LLM_REASONING`, and `VISION_BASE_URL`/`VISION_MODEL` if used. `LLM_CONTEXT_WINDOW` must match the model's real context (for Ollama, its `num_ctx`) and should be at least 32768: compaction starts at the window minus a 16,384-token reserve, and the kept recent history shrinks to fit (about 3,200 tokens for the teacher at 32k), so a larger window compacts less often. Set `HTTPS_PROXY` (URL-encode special characters) only on the host. Set `LH_ADMIN_USERNAME` to the username of the admin account (see Administration below). Optionally set `KNOWLEDGE_SHARED_DIR` (directory of shared documents) and `KNOWLEDGE_INDEX_FILE` (output index path), then run `npm run index:shared` to add an admin-built folder index. Without them, users still share documents by uploading to the Shared pool on the Knowledge page.

### Quiz answer-key check (`QUIZ_ANSWER_CHECK`)
On by default. Before a quiz reaches the learner, the app makes one small extra call to the same model (no tools, thinking off, a few output tokens), asking which option the quiz's explanation supports. If that differs from the quiz's answer key, the quiz goes back to the model to fix. It adds roughly 1–2 s per quiz; a timeout (10 s) or error lets the quiz through unchecked. Set `QUIZ_ANSWER_CHECK=false` and restart to turn it off.

### Pictures in PowerPoint, Word and PDF files
Picture reading is **opt-in per upload**: a "Read pictures (slower)" box appears on each attached PPTX, Word or PDF file in the chat box and on the Knowledge page, but only when the server has a vision model. It is off until a user ticks it; each user's choice is remembered on their account (`readPictures` in `accounts.json`). Ticked pictures are described by the vision model and indexed as text where they appear: under their slide (PPTX), page (PDF) or heading (Word), for chat attachments and saved knowledge alike. Scanned PDFs are skipped (their pages are already read by OCR), as are template/header/footer art and duplicates; at most 30 pictures per file, each call sharing the background model limit so chats stay responsive. Each picture is asked with reasoning off, up to 1,536 tokens and 180 s (dense manual pages took ~700 tokens and 46–51 s on the 12B laptop model). A saved file read as text only shows a **Read pictures** button on the Knowledge page (owner for personal files, anyone for shared ones); re-attaching it with the box ticked does the same, in place. A picture that cannot be read never fails the upload: the text is kept and the user sees a note naming the slides, pages or headings.

**More models (model selection).** Model 1 is `LLM_*`. Add more with numbered blocks — `LLM_2_BASE_URL`, `LLM_2_MODEL`, `LLM_2_CONTEXT_WINDOW`, `LLM_2_MAX_TOKENS`, `LLM_2_VISION`, `LLM_2_REASONING`, optional `LLM_2_API_KEY` — then `LLM_3_*`, and so on; the first missing number ends the list. Each block can point at a different server (for example Gemma via the proxy on .126 as model 1, LM Studio on the Mac as model 2); put every host in `NO_PROXY`. Model names must differ. Learners pick the model by name on the new-session screen, and the session keeps it for probing, planning, teaching, research and compaction. If a session's model is later removed, the session continues on model 1 and the chat says so once. Notes extraction and picture reading use model 1. gpt-oss models (name contains `gpt-oss`) get LM Studio's tool-call fix automatically.

The vision model is `VISION_BASE_URL` + `VISION_MODEL` when both are set, otherwise the main model when `LLM_VISION=true`; with neither, files are read as text only and the box is hidden.

**On a host with the Gemma 4 proxy, send pictures straight to LM Studio, not through the proxy.** The proxy turns each chat into a plain-text prompt for LM Studio's `/v1/completions`, which cannot carry images, so through the proxy the model never sees the picture (it answers "Please provide the image…"). Set:
```bash
LLM_VISION=false
VISION_BASE_URL=http://127.0.0.1:1234/v1     # LM Studio itself
VISION_MODEL=<the model id LM Studio lists>
```
The same route also serves **images attached in a chat** (PNG, JPEG, WebP) in any session — Chat, Teaching, Practice. With `LLM_VISION=false` and `VISION_*` set, each attached image is described once by the vision model and the chat model reads the description; the learner still sees the image. Without `VISION_*`, the chat model is told the image was omitted. (With `LLM_VISION=true` and the proxy in front, the image is silently lost — the model answers as if nothing was attached.)

LM Studio needs Gemma 4's vision projector (mmproj) loaded. Check before relying on it:
```bash
IMG=$(base64 -w0 some-small.png)
curl -s http://127.0.0.1:1234/v1/chat/completions -H 'content-type: application/json'   -d '{"model":"<VISION_MODEL>","max_tokens":1024,"reasoning_effort":"none","messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,'"$IMG"'"}},{"type":"text","text":"Describe this image."}]}]}' | head -c 600
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
If `npm run build` fails in webpack hashing (`WasmHash._updateWithBuffer ... reading 'length'`), the persistent webpack cache is corrupt: delete `.next/cache/webpack` (`rm -rf .next/cache/webpack`) and build again; the next build recreates it. On 2026-11-24 this fixed the failure reported in `docs/evaluations/2026-11-23-summary.md`.

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
