# VK Donut access gate — pilot, not deployed

Frozen diagnostic: `sales-diagnostic/index.html`, v1.13.32-dev. The Worker at a separate access URL authenticates with VK ID, checks an active VK Donut subscription using the VK API and only then serves the original HTML. No main branch changes.

## What is verified and what is not (13 October 2026)

- Official [VK API schema](https://github.com/VKCOM/vk-api-schema/blob/master/groups/methods.json) lists `groups.getMembers` with `filter=donut` and accepts `group` access-token type; the filtered response schema permits member objects with an integer `id`. The gate handles both integer IDs and objects with integer `id`.
- The [VK ID SDK](https://github.com/VKCOM/vkid-web-sdk/blob/master/src/auth/auth.ts) implements PKCE `s256`, code exchange at `/oauth2/auth`, identity lookup at `/oauth2/user_info`. The gate follows the same endpoints.
- Automated tests use **mocked VK**, not a real community token. Official schema compatibility is not proof of actual token permissions or operation on a real community. Live VK ID, Donut activation/expiry and Cloudflare staging remain **unverified**.
- Protected origin denies `/`, `/index.html` and every other asset without current membership; `assets.run_worker_first=true`. GitHub source and legacy HTMLPreview URL remain public by deliberate business decision.

## Staging deployment through Cloudflare Builds (owner-approved, 13 October 2026)

Cloudflare dashboard now has a GitHub connection for the **existing** Worker `sales-diagnostic-vk-donut` at `https://sales-diagnostic-vk-donut.kaaster.workers.dev` (previously Hello World). The owner selected `BoaKaa/max-bouquet-calculator`, production branch `sales-diagnostic-vk-donut-access`, repository root `/`, build command `cd access-gate && npm install && npm test && npm run build`, deploy command `cd access-gate && npx wrangler deploy`, and disabled preview builds. This README-only commit is intended to trigger the **first staging build** after connection; its outcome must be verified in Cloudflare Deployments, not inferred from GitHub CI.

The dashboard shows runtime `VK_APP_ID=54820831`, `VK_GROUP_ID=50026534`, encrypted `VK_GROUP_TOKEN` and encrypted `SESSION_SECRET`. Their values remain in Cloudflare. Wrangler has `keep_vars: true` so subsequent CLI deployments preserve dashboard-defined secrets. The Cloudflare Builds *build-time* variables panel may be empty: runtime secrets are not build variables and must not be copied there. Check logs for Worker name, asset upload, secret preservation, errors and API access. Never interpret a successful build as successful live VK Donut authorization.

## Setup for the owner — public parameters first

1. Choose or create a **Cloudflare account** at https://dash.cloudflare.com/ and go to **Workers & Pages**. Decide the intended staging hostname (for example, a new `*.workers.dev` name). Do not publish the worker yet. The callback must match its final HTTPS origin exactly.
2. Open the [official VK ID application setup](https://id.vk.com/business/go/docs/ru/vkid/latest/vk-id/connection/create-application) and create a **Web** app in the VK ID developer/business cabinet. Specify your staging domain as the base domain, and trust the precise redirect: `https://<STAGING-HOST>/auth/callback`. Copy the **numeric App ID** (`VK_APP_ID`). App ID is public.
3. In the paid VK community, locate the **numeric community ID** (`VK_GROUP_ID`, not the short `vk.com/name` address). Check that VK Donut is enabled and has an actual paying test subscriber. Obtain a community access token through **Управление → Работа с API → Ключи доступа**. Assign only available necessary permissions; do not assume the UI explicitly provides a "donut" checkbox.
4. Configure `VK_APP_ID`, `VK_GROUP_ID` in `access-gate/wrangler.jsonc`. If needed, configure `VK_OWNER_USER_ID` to the **numeric personal VK account ID** of the owner (not community ID): this bypass is conditional on a valid VK ID login.
5. Keep the **community access token** (`VK_GROUP_TOKEN`) and a newly generated random `SESSION_SECRET` of at least 32 strong random characters **only in Cloudflare Worker secrets**, not in GitHub, chat, commit messages, screenshots or plaintext Wrangler vars. If deployment is explicitly approved and credentials exist, use `npx wrangler secret put VK_GROUP_TOKEN` and `npx wrangler secret put SESSION_SECRET` from `access-gate/` (or Cloudflare dashboard Worker → Settings → Variables and Secrets). Use actual secret-type bindings, not regular vars.
6. After explicit staging permission: from `access-gate/`, run `npm install`, `npm test`, `npm run build` and `npx wrangler deploy`. Build copies unchanged source HTML into ignored `dist/index.html`; Worker protects it via `ASSETS`. **Do not run these commands as a public production launch by default.**

## Staging acceptance — do not claim success until witnessed

- Account A: live paid subscriber successfully completes VK ID login and sees HTML. API membership response and correct community must be checked server-side without logging access tokens.
- Account B: non-paying account receives denial both for `/` and `/index.html`, despite forwarding of the URL; check unknown routes and no direct asset bypass.
- Account A after a real paid-access expiry: check current VK status and deny new loads; an open tab rechecks about every 10 minutes and on return. Billing cancellation **before** expiry may leave current paid time; the authoritative criterion is current Donut status.
- Owner login: only exact configured numeric personal VK ID bypasses membership after identity verification; a different account must not.
- VK timeout/API error, malformed response or revoked token: fail closed with an explanatory screen.
- On the **same protected origin and same browser**, expired or non-paying users can click **Скачать мою историю (JSON)** on the entry screen. No login or payment is needed to export local history; this never opens the diagnostic app. The JSON shape matches the existing app's `exportVersion=1 / historySchemaVersion=2 / cycles`. Data is not sent to server. If data originated on HTMLPreview/GitHub Pages or another device, export there first and import after login on the new origin: `localStorage` does not transfer between domains.
- Test export/import with a realistic saved cycle, follow-up and linked history. Corrupt/unknown local records are never overwritten by the entry screen; users are told to ask for help.

## Operational notes and limits

- Session: signed Secure, HttpOnly, SameSite=Lax cookie, max 12h. Fresh Donut lookup on each app load and API probe, tab probe every 10 minutes and on visibility return. Revocation is **not instantaneous** in already-open tabs.
- Denial page can download data stored under `salesDiagnosticHistory:v2` **on that exact origin** only. A legacy-only `salesDiagnosticHistoryV1` record is not silently migrated or falsely labeled as importable; export legacy data using the application on the original origin before switch.
- The gate currently scans up to **30,000** filtered members, failing closed above the cap. Real-world pagination, rate limits and group-token permissions need staging proof.
- Never merge to `main`, issue a release tag or publish for end users without separate owner decision.

## Sources

- VK API `groups.getMembers` supported filter and tokens: https://github.com/VKCOM/vk-api-schema/blob/master/groups/methods.json
- VK API filtered response objects: https://github.com/VKCOM/vk-api-schema/blob/master/groups/responses.json
- VK API filtered member ID shape: https://github.com/VKCOM/vk-api-schema/blob/master/groups/objects.json
- VK ID SDK official source: https://github.com/VKCOM/vkid-web-sdk/blob/master/src/auth/auth.ts
- Cloudflare Worker-first assets: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
