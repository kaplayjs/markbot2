# MarkBot

MarkBot is a Bot about Mark

## Installation

```js
git clone https://github.com/kaplayjs/markbot.git
cd markbot
pnpm install
```

## Development

Run `npm run typecheck` to check TypeScript across the Worker and CLI scripts.
Run `npm run cf:types` after changing `wrangler.toml` or upgrading Wrangler to
refresh the Cloudflare environment and runtime declarations.

`/api query` suggests matching API names as you type, using `version` (v4000
by default). Enter a type followed by a dot, such as `Vec2.`, to preview its
members and their descriptions. After deploying changes to command options,
run `npm run register` to update the global commands in Discord.

For production, set the production bot's `DISCORD_TOKEN` and
`DISCORD_APPLICATION_ID` in `.vars`, then run `npm run deploy:prod` to deploy
and register its commands. Run `npm run register:prod` to register without
deploying. Production registration loads `.vars` only; preview registration
(`npm run register`) loads `.dev.vars`. Both files are ignored by Git, and
environment variables take precedence so CI can supply credentials as secrets.

You can run the bot locally by using:

```bash
pnpm run dev
```

And using `ngrok` to expose the local server:

```bash
ngrok http 8787
```
## Member messages

The gateway sends welcome messages to `WELCOME_CHANNEL_ID` and departure
messages to `LEAVE_CHANNEL_ID` for members of `WELCOME_GUILD_ID`. Set
`LEAVE_CHANNEL_ID` in `wrangler.toml` to enable departure messages; leaving it
empty disables them. Bot accounts are ignored. The bot needs permission to view
and send messages in the destination channel, and the Server Members intent
must be enabled in the Discord Developer Portal.

Discord's member removal event also covers kicks and bans, so those departures
receive the same message.

Send `markbot.test.leave` in `WELCOME_GUILD_ID` to preview your departure
message in `LEAVE_CHANNEL_ID` without leaving the server.

The gateway keeps its Discord connection open and resumes its saved session on
reconnect. Heartbeats detect broken connections; a watchdog checks healthy
connections every five minutes, and a fallback cron runs every fifteen minutes.
Failed connections retry with exponential backoff up to fifteen minutes to avoid
repeated requests during outages. Departure messages go to `900101147572989982`.

These intervals reduce Durable Object invocations and alarm writes, but outgoing
WebSockets cannot hibernate, so the connected object still incurs duration usage.
