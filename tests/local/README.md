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
- `deploy_verify.py`, `setup_faults.py` (needs `--email`), `actions_ui.mjs`, `settings_ui.mjs`, `walk_ui.mjs`: real application on simulated Portainer, GitHub and registry. Not production evidence, and rollback checks use JARs, not published images.

## Email test failures

Run `node --test tests/local/readiness.test.mjs` for the restart readiness fault cases.
Run `node tests/local/verify_email.mjs` only once per fresh email-enabled lab, with no other suite using it.
The restart probe requires health `UP`, bounds each request (including its body), and fails the suite on
deadline expiry. It does not retry auth mutations. Login and resend checks observe their POST responses;
the cooldown check still requires a 429, disabled UI, then a single successful resend after 61 seconds.
The original navigation deadlines and all security assertions remain in place.

Retain the process exit code and the complete result, including failures, outside temporary lab folders.
Failure traces contain auth paths, statuses and response dates; cooldown diagnostics compare host wall time,
monotonic elapsed time and the container clock. Never retain request bodies, auth headers or mail files.
Host standby or clock adjustments can disrupt these real-time checks: correlate OS events with the failure,
and do not call a later green run a diagnosis. A clock skew sample taken only after failure cannot prove that
the clocks stayed synchronized throughout the run. Likewise, a post-restart 502 does not explain an earlier
cooldown or login failure without its own request evidence.

`node tests/local/email_concurrency.mjs` needs its own fresh `--email` lab with the current compiled
`labmail` fixture. It holds a real login response to check that verification remains busy, and pauses the
synthetic mail provider to overlap resend with verification. It observes PostgreSQL lock waiting and
checks that resend cannot undo a successful verification. It also injects a failed resend, checks that
the previous code survives and is consumed only once, and verifies that a supported synthetic admin
suspension cannot be lifted by email verification. No production credentials or mail provider are used.

The cooldown boundary unit tests cover rounded-up advertised waits and a controlled backward clock
step. The latter reproduces a wall-clock timing mechanism; it does not establish the cause of earlier
untraced failures. Keep that distinction when reporting the new concurrency fixes or successful runs.
