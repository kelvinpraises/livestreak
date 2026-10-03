# RTMP broadcaster example

A standalone consumer of `@livestreak/cli/agent-client`. It creates an observation, selects RTMP, registers a market, publishes FFmpeg video and audio, proves a separate viewer receives init plus advancing fragments, and then marks the market live. Independent Bookmaker and viewer gateways create a vault and fund a position while the producer continues. It creates a bound discretionary mandate, verifies identical authoritative terms through independent Viewer and Steward gateways, retries creation against the same operation identity, pauses/resumes, and stops the run in cleanup. This is a local integration demonstration, not a production bot authorized to operate the Viewer or Steward roles.

## Run

Requires Node 22, FFmpeg with RTMP, libx264 and AAC, a running Host, deployed local EVM contracts with a funded paymaster and the Flow03 bound-vault contract version (legacy deployments explicitly reject this feature), and four independently authenticated role gateways (Broadcaster, Bookmaker, Viewer and Steward), with seed/funding balances. Their scoped grants must permit the actions and board reads/subscriptions used here. The bot receives gateway pairing credentials, never signing keys.

Build and pack the CLI from the repository, then install that tarball in this example (or a fresh copy):

```sh
npm run build --workspace=cli
npm pack --workspace=cli
cd examples/rtmp-broadcaster
npm install ../../livestreak-cli-0.1.0.tgz ws
cp broadcast.example.json broadcast.json
# Fill in the four independent role session IDs and pairing passwords.
LIVESTREAK_BROADCAST_CONFIG=broadcast.json npm run broadcast
```

Do not commit populated credentials. Use a separate viewer identity, not the broadcaster's wallet. Open the printed `STREAM_READY` market ID at the app's `/stream/<marketId>` route, with demo fixtures disabled. The default producer is a moving test pattern with an audible tone; any ordinary same-host RTMP producer can use the published receiver URL instead when driving the role manually.

The receiver binds **127.0.0.1 only**. Its stream name is routing information, not authentication; this example does not claim public authenticated ingress. Audio is explicitly enabled and required here. Public capture configuration can select `audio: false` for video-only producers.

The receipt records successful actions, viewer byte counts, fragments during and after economic writes, and pause/resume/stop state. `mediaFile` is a local verification artifact, not a platform replay upload. Stopping media does not end the on-chain market or resolve the vault; those are separate flows. The optional `exerciseControls: false` skips the pause/resume demonstration. `keepAliveMs` leaves time to watch the app before cleanup.
