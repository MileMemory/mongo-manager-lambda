# AWS Lambda

`buildspec.yml` (CodeBuild) produces `lambda.zip`. Its handler, `index.mjs`, starts the server once per container
and proxies function URL / API Gateway (HTTP API v2) events to it over loopback. No layer is needed.

Function settings:

- Runtime `nodejs24.x`, handler `index.handler`.
- Front it with a function URL or an HTTP API. Give it a generous timeout and at least 1024 MB of memory.
- Optional env: `MM_DATA_DIR` (default `/tmp/mongo-manager`), `MM_WEB_PORT` (default 8080).

Limits: no WebSockets or streaming responses (live features such as change streams will not work).
`/tmp` is ephemeral, so the data directory and secret key reset on a cold start. Set `MM_DATA_DIR` to a mounted EFS
path to keep them.
