# SearXNG image for offline install

Official `searxng/searxng:latest` from Docker Hub, version 2026.11.15-2d500cb6b
(image id sha256:932f69dca010db9880bddebb2171f05d8e1a25d04a59149ff65409993d680024),
saved with `docker save | gzip` for servers that cannot reach Docker Hub.

File: searxng-2026.11.15.tar.gz (96.9 MB)
sha256: cfa7f570ecaed419e01e725db2fc208c94b05d0d066ef93c9e4cae3ffab7f2cd

This branch is standalone: it shares no history with office and must never be merged.

## Load on the server
```bash
cd ~/app && git fetch origin searxng-image
git show origin/searxng-image:searxng-2026.11.15.tar.gz > ~/searxng.tar.gz
sha256sum ~/searxng.tar.gz        # must match the sha256 above
gunzip -c ~/searxng.tar.gz | docker load
deploy/searxng.sh start
```
