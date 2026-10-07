# Public demo deployment

The frontend is published at **https://livestreak.vercel.app**. Vercel serves the
static application; the Node Host stays on the operator's laptop and is reached
through an HTTPS/WSS Cloudflare Tunnel. Arbitrum Sepolia is the deployed EVM
network. This does not move the Host into a Vercel function.

## Host and tunnel

Use Node 22 and retain the existing private `.env` containing the database,
storage and wallet-provider configuration. Start the Host from the repository:

```sh
npm run dev --workspace=@livestreak/host-server
```

In a separate shell, start a tunnel:

```sh
cloudflared tunnel --protocol http2 --url http://127.0.0.1:8787 --no-autoupdate
```

This setup uses HTTP/2 after the previous QUIC tunnel repeatedly lost its edge
connection. The tunnel still needs a working network connection.

Set these private environment values to the URL printed by cloudflared, then
restart the Host:

```dotenv
LIVESTREAK_HOST_BASE_URL=https://<tunnel>.trycloudflare.com
LIVESTREAK_APP_ORIGIN=https://livestreak.vercel.app
LIVESTREAK_HOST_BIND_HOST=127.0.0.1
LIVESTREAK_REMOTE_GRANT_KEY=<persistent 32-byte Ed25519 seed in hex>
```

Keep the grant key private and stable across restarts. Configure CLI settings
`host.url` to the same public Host URL so remote console links and live viewer
addresses use the deployed application and public relay.

The public R2 bucket needs GET/HEAD CORS for `https://livestreak.vercel.app`,
including the `Range` request header. Keep existing allowed origins when adding
this origin. Live media uses WSS; completed HLS recordings play directly from
the configured public storage URL. Host WebSocket protocol pings keep idle
connections active through the proxy.

## Frontend

The existing Vercel project is `flowstream` in `kelvinpraises-projects`, with
`livestreak.vercel.app` registered as a production project domain. Its root is
the workspace root, its Node version is 22.x, and `vercel.json` defines the
build and SPA fallback. Direct `/stream`, `/streams`, `/agents` and `/remote`
links must return the application's shell.

Set `VITE_HOST_BASE_URL` to the public Host URL in the project's Vercel
environment. For a local prebuilt deployment, also put it in ignored
`app/.env.local`; Vite embeds it at build time.

```sh
npm run build:packages:image
npm run build --workspace=app
rm -rf .vercel/output
mkdir -p .vercel/output/static
cp -R app/.output/public/. .vercel/output/static/
```

For `--prebuilt`, write `.vercel/output/config.json` with:

```json
{
  "version": 3,
  "routes": [
    { "handle": "filesystem" },
    { "src": "/.*", "dest": "/_shell.html" }
  ]
}
```

Then deploy using the installed CLI and the linked project:

```sh
vercel deploy --prebuilt --prod --yes --scope kelvinpraises-projects
```

Only the generated frontend is included in this prebuilt deployment. `.env`,
operator keystores, context artifacts and Host credentials stay on the laptop.

## Verification and availability

Check the public Host `/health`, then use the deployed site in the internal
browser to check indexed Streams, live video, an existing replay, wallet
connection and a sponsored test-token transaction. `/health` alone does not
prove the database, chain index or media playback works. A cold catalog refresh
can take longer than a warm response; stale records retain their freshness
labels until the chain has been read successfully.

Keep the laptop awake, online, and both processes running. A Quick Tunnel gets
a new URL when restarted: update both Host and frontend configuration, rebuild
and redeploy. A named tunnel with a stable domain removes that URL rotation;
moving the Host to an always-on server removes the laptop dependency.
