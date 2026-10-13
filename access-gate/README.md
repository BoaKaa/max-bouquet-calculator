# VK Donut access gate — pilot (not deployed)

The diagnostic `sales-diagnostic/index.html` is unchanged. Cloudflare Workers handles VK ID login, validates identity via VK ID `/oauth2/user_info`, and checks the community subscriber list with VK API `groups.getMembers?filter=donut`. The community token remains on the Worker server. HTML is only served after a fresh Donut check.

## Owner setup — required before live validation

1. Create a VK ID **web application**, register the exact HTTPS redirect `https://YOUR-WORKER-DOMAIN/auth/callback`, and copy the numerical App ID.
2. Find the numerical **VK community ID** and enable VK Donut. Generate a **community access token** with permissions to call `groups.getMembers` with `filter=donut`. The exact availability of this combination must be confirmed against the real community and a real subscriber.
3. Optionally set `VK_OWNER_USER_ID` to **your numerical personal VK account ID** in Worker vars. This account can enter after verified VK ID login without purchasing a subscription to its own community; other users still require VK Donut.
4. In `access-gate/wrangler.jsonc`, set numeric `VK_APP_ID` and `VK_GROUP_ID`. From `access-gate/` run `npx wrangler secret put VK_GROUP_TOKEN` and `npx wrangler secret put SESSION_SECRET`; the second must contain at least 32 random characters. **Do not commit tokens or paste secrets into chat.**
5. Run `npm install`, `npm test`, `npm run build`, then `npx wrangler deploy` from `access-gate/`. The build copies the diagnostic HTML into ignored `dist/index.html`. `assets.run_worker_first=true` protects every served asset.
6. On a staging Workers URL, verify a paying account, a non-paying account, and the same user after subscription expiry (as VK sees it). Verify forwarding URL to another browser does not grant access. Only distribute the **Worker URL**.
7. Export history from HTMLPreview as JSON and import it after login on the new Worker origin. `localStorage` does not migrate automatically.

## Guarantees and limits

- **No live OAuth or Donut verification has been performed** without owner-owned VK ID and group credentials. Tests currently mock the VK APIs. Do not call this production ready.
- PKCE S256 and random OAuth state are stored in an HMAC-signed 10-minute cookie. The returned user ID is validated by VK ID user_info. A signed HttpOnly/Secure/SameSite session lasts up to 12h. Membership is checked server-side on every app load and API probe; open tabs probe every 10 minutes and on focus. This is **not instant revocation**.
- If VK is unavailable, returns unexpected data, or lacks permission, access fails closed. The prototype paginates up to 30,000 donor IDs.
- No extra user database; existing diagnostic history stays in browser. When access expires, an inactive subscriber cannot open the application to export history until renewing. Warn to export before cancellation.
- Public GitHub and legacy HTMLPreview links still reveal an unprotected copy. To fully prevent copying, a later private-source or server-side move would be required; this pilot protects the **new access URL** rather than source code.
- No automatic deployment, release tag or merge to `main` is configured. Work is isolated in `sales-diagnostic-vk-donut-access`.

## Official references

- VK ID SDK: https://vkcom.github.io/vkid-web-sdk/docs/
- VK API groups.getMembers filter: https://github.com/VKCOM/vk-api-schema/blob/master/groups/methods.json
- Cloudflare Worker-first assets: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
