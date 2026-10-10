import { DurableObject } from "cloudflare:workers";

type Env = {
  DISCORD_TOKEN: string;
  WELCOME_GUILD_ID: string;
  WELCOME_CHANNEL_ID: string;
  LEAVE_CHANNEL_ID?: string;
  WELCOME_GATEWAY_REVISION?: string;
  WELCOME_TEST_COMMAND?: string;
};

type Session = { id: string; url: string; seq: number | null; };
type Recovery = {
  attempts: number;
  retryAt: number;
  error: string | null;
  halted?: boolean;
  config?: string;
};

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = (1 << 1) | (1 << 9) | (1 << 15);
const WATCHDOG_MS = 30_000;
const FATAL_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

/** Outgoing Discord sockets use the standard API, not WebSocket hibernation. */
export class WelcomeGateway extends DurableObject<Env> {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatPending = false;
  private connecting: Promise<void> | null = null;
  private session: Session | null = null;
  private recovery: Recovery = { attempts: 0, retryAt: 0, error: null };
  private config = "";
  private ready = false;
  private handshakeDeadline = 0;
  private messages: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify([
            env.DISCORD_TOKEN,
            env.WELCOME_GUILD_ID,
            env.WELCOME_CHANNEL_ID,
            env.LEAVE_CHANNEL_ID,
            env.WELCOME_GATEWAY_REVISION,
            INTENTS,
            GATEWAY_URL,
          ]),
        ),
      );
      this.config = Array.from(
        new Uint8Array(digest),
        byte => byte.toString(16).padStart(2, "0"),
      ).join("");
      this.session = await ctx.storage.get<Session>("session") ?? null;
      this.recovery = await ctx.storage.get<Recovery>("recovery")
        ?? this.recovery;
      if (this.recovery.halted && this.recovery.config !== this.config) {
        this.recovery = { attempts: 0, retryAt: 0, error: null };
        await ctx.storage.put("recovery", this.recovery);
      }
    });
  }

  async fetch(): Promise<Response> {
    await this.supervise();
    return Response.json({
      status: this.recovery.halted
        ? "blocked"
        : this.ready
          ? "ready"
          : this.ws
            ? "connecting"
            : "reconnecting",
      error: this.recovery.error,
    }, { status: this.ready ? 200 : 503 });
  }

  async alarm(): Promise<void> {
    await this.supervise();
  }

  private async supervise() {
    if (this.recovery.halted) {
      console.error(`[gateway] blocked: ${this.recovery.error}. Correct the Discord configuration and increment WELCOME_GATEWAY_REVISION.`);
      await this.ctx.storage.deleteAlarm();
      return;
    }
    // Arm first: an interrupted connection attempt must still have a wake-up.
    await this.ctx.storage.setAlarm(
      Math.max(Date.now() + WATCHDOG_MS, this.recovery.retryAt),
    );
    if (
      this.ws && (!this.ready && Date.now() >= this.handshakeDeadline
        || this.ws.readyState !== WebSocket.OPEN)
    ) {
      await this.disconnect(
        this.ws,
        "Gateway handshake or socket timed out",
      );
    }
    if (this.ws || Date.now() < this.recovery.retryAt) return;
    if (!this.connecting) {
      this.connecting = this.connect().catch(async (error) => {
        console.error("[gateway] connection attempt failed:", error);
        await this.scheduleReconnect("Gateway connection failed");
      }).finally(() => {
        this.connecting = null;
      });
    }
    await this.connecting;
  }

  private async connect() {
    const url = new URL(this.session?.url ?? GATEWAY_URL);
    url.protocol = "https:";
    url.searchParams.set("v", "10");
    url.searchParams.set("encoding", "json");
    const response = await fetch(url, {
      headers: { Upgrade: "websocket" },
      signal: AbortSignal.timeout(15_000),
    });
    const ws = response.webSocket;
    if (!ws) throw new Error(`Gateway upgrade failed: ${response.status}`);
    this.ws = ws;
    this.ready = false;
    this.handshakeDeadline = Date.now() + WATCHDOG_MS;
    ws.addEventListener("message", (event) => {
      // Serialize protocol/storage changes without blocking on welcome HTTP calls.
      this.messages = this.messages.then(() =>
        this.onMessage(ws, event.data as string)
      )
        .catch(async (error) => {
          console.error("[gateway] protocol handler failed:", error);
          await this.disconnect(ws, "Gateway protocol error");
        });
      this.ctx.waitUntil(this.messages);
    });
    ws.addEventListener("close", (event) => {
      if (ws !== this.ws) return;
      this.ctx.waitUntil(this.onClose(ws, event.code));
    });
    ws.addEventListener("error", () => {
      this.ctx.waitUntil(this.disconnect(ws, "Gateway socket error"));
    });
    ws.accept();
  }

  private cleanup(ws: WebSocket) {
    if (ws !== this.ws) return;
    this.ws = null;
    this.ready = false;
    if (this.heartbeatTimer !== null) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatPending = false;
    try {
      ws.close(4000, "Reconnecting");
    } catch { /* Already closed. */ }
  }

  private async scheduleReconnect(error: string, fatal = false) {
    const delay =
      Math.min(1000 * 2 ** Math.min(this.recovery.attempts, 6), 60_000)
      + Math.floor(Math.random() * 1000);
    this.recovery = {
      attempts: this.recovery.attempts + 1,
      retryAt: Date.now() + delay,
      error,
      halted: fatal,
      config: this.config,
    };
    console.error(
      `[gateway] ${error}; ${fatal
        ? "fix Gateway configuration to reconnect"
        : `retry in ${delay}ms`
      }`,
    );
    await this.ctx.storage.put("recovery", this.recovery);
    if (fatal) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(this.recovery.retryAt);
  }

  private async disconnect(ws: WebSocket, error: string) {
    if (ws !== this.ws) return;
    this.cleanup(ws);
    await this.scheduleReconnect(error);
  }

  private async clearSession() {
    this.session = null;
    await this.ctx.storage.delete("session");
  }

  private async onClose(ws: WebSocket, code: number) {
    if (ws !== this.ws) return;
    this.cleanup(ws);
    if ([1000, 1001, 4007, 4009].includes(code) || FATAL_CODES.has(code)) {
      await this.clearSession();
    }
    await this.scheduleReconnect(
      `Gateway closed: ${code}`,
      FATAL_CODES.has(code),
    );
  }

  private sendHeartbeat(ws: WebSocket) {
    ws.send(JSON.stringify({ op: 1, d: this.session?.seq ?? null }));
    this.heartbeatPending = true;
  }

  private startHeartbeat(ws: WebSocket, interval: number) {
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new Error("Invalid heartbeat interval");
    }
    if (this.heartbeatTimer !== null) clearTimeout(this.heartbeatTimer);
    this.heartbeatPending = false;
    const tick = () => {
      if (ws !== this.ws) return;
      try {
        if (this.heartbeatPending) {
          throw new Error("Heartbeat ACK missing");
        }
        this.sendHeartbeat(ws);
        this.heartbeatTimer = setTimeout(tick, interval);
      } catch {
        this.ctx.waitUntil(
          this.disconnect(ws, "Heartbeat failed or ACK missing"),
        );
      }
    };
    this.heartbeatTimer = setTimeout(tick, interval * Math.random());
  }

  private async onMessage(ws: WebSocket, raw: string) {
    if (ws !== this.ws) return;
    const { op, d, s, t } = JSON.parse(raw);
    if (op === 10) {
      this.startHeartbeat(ws, d.heartbeat_interval);
      ws.send(JSON.stringify(
        this.session
          ? {
            op: 6,
            d: {
              token: this.env.DISCORD_TOKEN,
              session_id: this.session.id,
              seq: this.session.seq,
            },
          }
          : {
            op: 2,
            d: {
              token: this.env.DISCORD_TOKEN,
              intents: INTENTS,
              properties: {
                os: "cloudflare",
                browser: "markbot",
                device: "markbot",
              },
            },
          },
      ));
    }
    else if (op === 1) {
      this.sendHeartbeat(ws);
    }
    else if (op === 11) {
      this.heartbeatPending = false;
    }
    else if (op === 7 || op === 9) {
      this.cleanup(ws);
      if (op === 9 && !d) await this.clearSession();
      await this.scheduleReconnect("Gateway requested reconnect");
    }
    else if (op === 0) {
      if (t === "READY") {
        this.session = {
          id: d.session_id,
          url: d.resume_gateway_url,
          seq: s,
        };
      }
      if (this.session && s != null) {
        this.session.seq = s;
        await this.ctx.storage.put("session", this.session);
      }
      if (ws !== this.ws) return;
      if (t === "READY" || t === "RESUMED") {
        this.ready = true;
        this.recovery = { attempts: 0, retryAt: 0, error: null };
        await this.ctx.storage.put("recovery", this.recovery);
        await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_MS);
        console.log(`[gateway] ${t}`);
      }
      const leavingUser = t === "GUILD_MEMBER_REMOVE"
        ? d.user
        : t === "MESSAGE_CREATE"
          && d.content?.trim().toLowerCase() === "markbot.test.leave"
          ? d.author
          : null;
      if (
        leavingUser && !leavingUser.bot
        && d.guild_id === this.env.WELCOME_GUILD_ID
        && this.env.LEAVE_CHANNEL_ID
      ) {
        this.ctx.waitUntil(
          this.leave(leavingUser).catch((error) => {
            console.error("[gateway] leave message failed:", error);
          }),
        );
      }
      const user = t === "GUILD_MEMBER_ADD"
        ? d.user
        : t === "MESSAGE_CREATE"
          && d.content?.trim().toLowerCase() === "markbot.test.join"
          ? d.author
          : null;
      if (d.guild_id === this.env.WELCOME_GUILD_ID && user && !user.bot) {
        this.ctx.waitUntil(
          this.welcome(user).catch((error) => {
            console.error("[gateway] welcome failed:", error);
          }),
        );
      }
    }
  }

  private async leave(user: { id: string; username: string; }) {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${this.env.LEAVE_CHANNEL_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.env.DISCORD_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: `<:ghosty:1271977116442820669> <@${user.id}> (${user.username}) has left the server. A new ghosty was born. `,
          allowed_mentions: { parse: [] },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Leave message failed: HTTP ${response.status}`);
    }
  }

  private async welcome(
    user: { id: string; username: string; avatar: string | null; },
  ) {
    const userId = user.id;
    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png`
      : "https://cdn.discordapp.com/embed/avatars/0.png";
    const response = await fetch(
      `https://discord.com/api/v10/channels/${this.env.WELCOME_CHANNEL_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.env.DISCORD_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: `<@${userId}>`,
          embeds: [{
            title: `oh hi ${user.username}!`,
            // avatar author of newjoiner
            author: {
              name: user.username,
              icon_url: avatarUrl,
            },
            // this photo as thumbnail too
            thumbnail: {
              url: avatarUrl,
            },
            description:
              `Welcome to the KAPLAY Discord Community, a place to talk about KAPLAY, game development and other stuff. Here are some tips <:mark:1271979122372907121>

* Dealing with code? Ask for <#883782079802908772>!
* Talk around in <#883781995384152137>
* Want to contribute? <#883782527809122367>

`,
            image: {
              url: `https://i.imgur.com/xjRqxvX.gif`,
            },
            footer: {
              text: "MarkBot™",
              icon_url: "https://cdn.discordapp.com/avatars/954363341051154522/5ae01d400f8d6c534df315798bd55751.webp?size=1536",
            },
            color: 0xabdd65,
          }],
          allowed_mentions: { users: [userId] },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Welcome message failed: HTTP ${response.status}`);
    }
  }
}
