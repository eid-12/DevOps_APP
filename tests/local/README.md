# Local verification lab

Disposable, network-isolated copy of CloudBase: the built backend JAR and frontend, a throwaway Postgres
(tmpfs) and a synthetic Portainer/NPM stand-in. All accounts and secrets are synthetic; the lab has no
outbound network and never touches production.

```sh
cd backend && mvn clean verify && cd ../frontend && npm ci && npm run build && cd ..
python tests/local/lab.py start --jdk --jwt-expiration-ms 45000 \
  --jar backend/target/cloudbase-backend-0.0.1-SNAPSHOT.jar --frontend frontend/dist/cloudbase-frontend/browser
python tests/local/verify_api.py          # real HTTP + Postgres: auth, tenancy, protected fields, health, account status
node tests/local/ws_verify.mjs            # STOMP over SockJS on the real broker: delivery, isolation, suspension, expiry, leaks
cd tests/local && npm ci && npm run browser   # Playwright 1.64.1 on the installed Microsoft Edge
python tests/local/lab.py stop            # removes only this lab's labelled containers, volumes and network
```

- `--jdk` runs the API on a JDK image so `ws_verify.mjs` can count retained sessions with `jcmd`.
- `--jwt-expiration-ms` shortens tokens so the expiry checks finish quickly.
- `verify_api.py` needs a fresh lab and must run before `browser.mjs` (it creates the fixtures). `ws_verify.mjs` also
  registers fixed accounts, so run it once per lab. `browser.mjs` resets its fixture and can be re-run.
- `rollback_check.py --old-jar <jar> --new-jar <jar>` (lab started with the new jar and default token lifetime) proves
  rollback compatibility of session revocation and the `JWT_SECRET` rotation recovery; see docs/operations.md.
- Lab state lives in `%TEMP%/cloudbase-isolated-lab/` (state, API results, browser screenshots).
