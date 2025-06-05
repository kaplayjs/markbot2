/**
 * The core server that runs on a Cloudflare worker.
 */

import {
    type APIApplicationCommandInteraction,
    type APIInteractionResponse,
    type APIPingInteraction,
    ComponentType,
    InteractionResponseType,
    InteractionType,
    MessageFlags,
} from "discord-api-types/v10";
import { verifyKey } from "discord-interactions";
import { AutoRouter } from "itty-router";
import { ABOUT_CMD, API_CMD, KAT_CMD } from "./commands.js";
import { getCuteCatUrl } from "./reddit.js";

class JsonResponse extends Response {
    constructor(
        body: APIInteractionResponse | { error: string },
        init?: ResponseInit | undefined,
    ) {
        const jsonBody = JSON.stringify(body);

        init = init || {
            headers: {
                "content-type": "application/json;charset=UTF-8",
            },
        };

        super(jsonBody, init);
    }
}

const router = AutoRouter();

type JSDocTag = {
    name: string;
    value: string;
};

type DocEntryData = {
    name: string;
    queryName: string;
    title: string;
    children: DocEntryData[];
    description?: string;
    example?: string[];
    tags?: JSDocTag[];
};

/**
 * A simple :wave: hello page to verify the worker is working.
 */
router.get("/", (request, env) => {
    console.log(env);
    return new Response(`👋 ${env.DISCORD_APPLICATION_ID}`);
});

/**
 * Main route for all requests sent from Discord.  All incoming messages will
 * include a JSON payload described here:
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 */
router.post("/", async (request, env) => {
    const { isValid, interaction } = await server.verifyDiscordRequest(
        request,
        env,
    );
    if (!isValid || !interaction) {
        return new Response("Bad request signature.", { status: 401 });
    }

    if (interaction.type === InteractionType.Ping) {
        // The `PING` message is used during the initial webhook handshake, and is
        // required to configure the webhook in the developer portal.
        return new JsonResponse({
            type: InteractionResponseType.Pong,
        });
    }

    if (interaction.type === InteractionType.ApplicationCommand) {
        // Most user commands will come as `APPLICATION_COMMAND`.
        switch (interaction.data.name.toLowerCase()) {
            case KAT_CMD.name.toLowerCase(): {
                const cuteUrl = await getCuteCatUrl();
                return new JsonResponse({
                    type: InteractionResponseType.ChannelMessageWithSource,
                    data: {
                        content: cuteUrl,
                    },
                });
            }
            case ABOUT_CMD.name.toLowerCase(): {
                return new JsonResponse({
                    type: InteractionResponseType.ChannelMessageWithSource,
                    data: {
                        embeds: [{
                            description:
                                "Hey! I'm KAPLAY server bot.\n\n I'm getting a rewrite so all my commands are currently not avaible, lajbel is going to work on it very soon! (doubt it)",
                            color: 0xfcef8d,
                            author: { name: "MarkBot" },
                        }],
                    },
                });
            }
            case API_CMD.name.toLowerCase(): {
                if (interaction.data.type != 1) return;

                const queryOption = interaction.data.options?.find(
                    (o) => o.name === "query",
                );

                const versionOption = interaction.data.options?.find(
                    (o) => o.name === "version",
                );

                if (!queryOption) {
                    return new JsonResponse(
                        { error: "Missing required options." },
                        { status: 400 },
                    );
                }

                if (queryOption?.type != 3) return;
                if (versionOption != undefined && versionOption?.type != 3) {
                    return;
                }

                const userQuery = queryOption.value;
                const version = versionOption?.value.toLowerCase() ?? "v4000";

                // User Query can come in the following formats:
                // - "ctx.methodName"
                // - "TypeName.methodName"
                // - "TypeName"
                // - "methodName" (default to ctx.methodName)

                const queryParts = userQuery.split(".");
                let startQuery = queryParts[0] != "ctx"
                    ? queryParts[0]
                    : queryParts[1] || "";
                let querySpecific = "";

                if (queryParts.length >= 2 && queryParts[0] != "ctx") {
                    querySpecific = queryParts.pop() || "";
                }

                const names = await (await fetch(
                    `https://${
                        version == "v4000" ? "v4000" : ""
                    }.kaplayjs.com/api/doc/names.json`,
                )).json() as string[];

                let apiQuery = "";

                for (const name of names) {
                    let formattedName = name.startsWith("ctx.")
                        ? name.slice(4)
                        : name;

                    if (formattedName == startQuery) {
                        apiQuery = name;
                        break;
                    }
                }

                if (!apiQuery) {
                    return new JsonResponse({
                        type: InteractionResponseType.ChannelMessageWithSource,
                        data: {
                            embeds: [{
                                title:
                                    `/api query:\`${userQuery}\` - No documentation found`,
                                description:
                                    `No documentation found for \`${userQuery}\` in version \`${version}\`.`,
                                color: 0xff0000,
                            }],
                        },
                    });
                }

                console.log(
                    `Query: ${apiQuery}, Specific: ${querySpecific}, Version: ${version}`,
                );

                const url = version === "v3001"
                    ? `https://kaplayjs.com/api/doc/${apiQuery}.json`
                    : `https://v4000.kaplayjs.com/api/doc/${apiQuery}.json`;

                const data = await (await fetch(url))
                    .json() as DocEntryData[];

                let description = "";

                const registerDoc = (
                    entry: DocEntryData,
                    children?: boolean,
                ) => {
                    let url = apiQuery.startsWith("ctx.")
                        ? `https://kaplayjs.com/doc/ctx/${apiQuery}`
                        : `https://kaplayjs.com/doc/${apiQuery}`;

                    if (children) {
                        url += `#${apiQuery}-${entry.name}`;
                    }

                    const headingLevel = children ? "##" : "#";
                    description += `${headingLevel} ${
                        entry.title.replace(/\n/g, "").trim()
                    }\n`;
                    description += `${entry.description || ""}\n\n`;

                    if (entry.tags) {
                        entry.tags.forEach((tag) => {
                            description += `- \`${tag.name}\`: ${tag.value}\n`;
                        });

                        description += "\n";
                    }

                    if (!children) {
                        description += `[Open in KAPLAY Docs](${url})\n`;
                    }

                    if (entry.example) {
                        description += "```js\n";
                        entry.example.forEach((line) => {
                            description += line + "\n";
                        });
                        description += "```\n";
                    }

                    if (entry.children) {
                        if (entry.children.length < 20) {
                            entry.children.forEach((child) => {
                                registerDoc(child, true);
                            });
                        }
                        else {
                            description +=
                                `\n *Too many members to display. Use \`${entry.queryName}.member\` to get more information. *\n\n`;
                            entry.children.forEach((child) => {
                                description += `\`${child.name}\`, `;
                            });
                        }
                    }
                };

                for (const entry of data) {
                    if (querySpecific) {
                        const child = entry.children.find((child) => {
                            if (child.name === querySpecific) {
                                return child;
                            }
                        });

                        if (child) {
                            registerDoc(child);
                        }
                        else {
                            return new JsonResponse({
                                type: InteractionResponseType
                                    .ChannelMessageWithSource,
                                data: {
                                    embeds: [{
                                        title:
                                            `/api query:\`${userQuery}\` - No documentation found`,
                                        description:
                                            `No documentation found for \`${userQuery}\` in version \`${version}\`.`,
                                        color: 0xff0000,
                                    }],
                                },
                            });
                        }
                    }
                    else {
                        registerDoc(entry);
                    }
                }

                return new JsonResponse({
                    type: InteractionResponseType.ChannelMessageWithSource,
                    data: {
                        embeds: [{
                            title: `/api query:\`${userQuery}\``,
                            description: description.length > 4000
                                ? description.slice(0, 4000) + "..."
                                : description,
                            color: 0xabdd64,
                            footer: {
                                text: "Provided by https://kaplayjs.com",
                                icon_url: "https://kaplayjs.com/favicon.png",
                            },
                        }],
                    },
                });
            }
            default:
                return new JsonResponse({ error: "Unknown Type" }, {
                    status: 400,
                });
        }
    }

    console.error("Unknown Type");
    return new JsonResponse({ error: "Unknown Type" }, { status: 400 });
});
router.all("*", () => new Response("Not Found.", { status: 404 }));

async function verifyDiscordRequest(request, env) {
    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const body = await request.text();
    const isValidRequest = signature
        && timestamp
        && (await verifyKey(
            body,
            signature,
            timestamp,
            env.DISCORD_PUBLIC_KEY,
        ));
    if (!isValidRequest) {
        return { isValid: false };
    }

    return {
        interaction: JSON.parse(body) as
            | APIApplicationCommandInteraction
            | APIPingInteraction,
        isValid: true,
    };
}

const server = {
    verifyDiscordRequest,
    fetch: router.fetch,
};

export default server;
