/**
 * The core server that runs on a Cloudflare worker.
 */

import {
    type APIApplicationCommandInteraction,
    type APIApplicationCommandInteractionDataUserOption,
    type APIInteractionResponse,
    type APIPingInteraction,
    ApplicationCommandOptionType,
    InteractionResponseType,
    InteractionType,
} from "discord-api-types/v10";
import { verifyKey } from "discord-interactions";
import { AutoRouter, type IRequest } from "itty-router";
import { ABOUT_CMD, API_CMD, HELPEDBY_CMD, KAT_CMD } from "./commands.js";
import { getCuteCatUrl } from "./reddit.js";
import { getDB } from "./db.js";

class JsonResponse extends Response {
    constructor(
        body: APIInteractionResponse | { error: string; },
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

const router = AutoRouter<IRequest, [Env, ExecutionContext]>();

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
router.get("/", async (request, env) => {
    // Also wakes the welcome gateway (cron doesn't run in `wrangler dev`).
    const gateway = await env.WELCOME_GATEWAY.get(env.WELCOME_GATEWAY.idFromName("main"))
        .fetch("https://welcome/");
    if (!gateway.ok) return gateway;
    return new Response(`👋 ${env.DISCORD_APPLICATION_ID}`);
});

router.get("/gateway/status", async (_request, env) => {
    return env.WELCOME_GATEWAY.get(env.WELCOME_GATEWAY.idFromName("main"))
        .fetch("https://welcome/");
});

const kaplayUrl = (url: string, v: string) =>
    `https://${v == "v4000" ? "v4000." : ""}kaplayjs.com/${url}`;

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
                                "Hey! I'm KAPLAY server bot.",
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

                const namesUrl = kaplayUrl(
                    "api/doc/names.json",
                    version,
                );

                const names = await (await fetch(namesUrl)).json() as string[];

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

                const url = kaplayUrl(`api/doc/${apiQuery}.json`, version);

                const data = await (await fetch(url))
                    .json() as DocEntryData[];

                let description = "";

                const registerDoc = (
                    entry: DocEntryData,
                    children?: boolean,
                ) => {
                    let url = apiQuery.startsWith("ctx.")
                        ? kaplayUrl(`doc/ctx/${apiQuery}`, version)
                        : kaplayUrl(`doc/${apiQuery}`, version);

                    if (children) {
                        url += `#${apiQuery}-${entry.name}`;
                    }

                    const headingLevel = children ? "##" : "#";
                    description += `${headingLevel} ${entry.title.replace(/\n/g, "").trim()
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
                                text: `Provided by ${kaplayUrl("", version)}`,
                                icon_url: "https://kaplayjs.com/favicon.png",
                            },
                        }],
                    },
                });
            }
            case HELPEDBY_CMD.name.toLocaleLowerCase(): {
                if (interaction.data.type != 1) return;

                const helpSubcommand = interaction.data.options?.find(
                    (o) => o.name === "help",
                );

                if (helpSubcommand) {
                    return new JsonResponse({
                        type: InteractionResponseType.ChannelMessageWithSource,
                        data: {
                            embeds: [{
                                title: `HelpedBy:tm:`,
                                description: "**HelpedBy:tm:** is a **MarkBot:tm:** system to reward the people who help you in <#883782079802908772> channel! Helping others is helping yourself. \n\nTo start rewarding the people who help you, you can use: \n\n `/helped by member:@MF`\n\n Also, you can see your profile or anyone's with: \n\n`/helped profile member:@lajbel`",
                                color: 0xabdd64,
                                footer: {
                                    text: "/helped help to display this message again."
                                }
                            }],
                        },
                    });
                }

                const bySubcommand = interaction.data.options?.find(
                    (o) => o.name === "by" && o.type === ApplicationCommandOptionType.Subcommand,
                );

                if (bySubcommand && bySubcommand.type === ApplicationCommandOptionType.Subcommand) {
                    const db = getDB(env.SUPABASE_KEY);
                    const member = bySubcommand.options?.find(
                        (o) => o.name === "member",
                    ) as APIApplicationCommandInteractionDataUserOption;
                    const givenPoints = 1;

                    const { data, error } = await db.rpc('give_points', {
                        p_from_user: interaction.member?.user.id!,
                        p_to_user: member.value,
                        p_points: givenPoints,
                    });

                    const resolvedUsers = interaction.data.resolved?.users!;
                    const userToData = resolvedUsers[member.value];

                    if (error) {
                        switch (error.code) {
                            case "P0001":
                                return new JsonResponse({
                                    type: InteractionResponseType.ChannelMessageWithSource,
                                    data: {
                                        embeds: [{
                                            title: `Error!`,
                                            description: `You can't give HelpPoints:tm: to yourself!`,
                                            color: 0xdd0000,
                                        }],
                                    },
                                });
                            default:
                                return new JsonResponse({
                                    type: InteractionResponseType.ChannelMessageWithSource,
                                    data: {
                                        embeds: [{
                                            title: `Error!`,
                                            description: "Uknown Error.",
                                            color: 0xdd0000,
                                        }],
                                    },
                                });
                        }
                    } else {
                        return new JsonResponse({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: {
                                embeds: [{
                                    title: `${userToData.global_name ?? userToData.username} helped ${interaction.member?.user.global_name ?? interaction.member?.user.username}!`,
                                    description: `<@${interaction.member?.user.id}> rewarded <@${member.value}> with **${givenPoints} HelpPoint:tm:**. Now <@${member.value}> ascends to ${data[0].to_total} HelpPoints.`,
                                    color: 0xabdd64,
                                    thumbnail: {
                                        url: `https://cdn.discordapp.com/avatars/${userToData.id}/${userToData.avatar}.png`,
                                    }
                                }],
                            },
                        });
                    }
                }

                const profileSubcommand = interaction.data.options?.find(
                    (o) => o.name === "profile" && o.type === ApplicationCommandOptionType.Subcommand,
                );

                if (profileSubcommand && profileSubcommand.type === ApplicationCommandOptionType.Subcommand) {
                    const db = getDB(env.SUPABASE_KEY);
                    const member = profileSubcommand.options?.find(
                        (o) => o.name === "member",
                    ) as APIApplicationCommandInteractionDataUserOption;
                    const resolvedUsers = interaction.data.resolved?.users!;
                    const userToData = resolvedUsers[member.value];

                    const { data, error } = await db.rpc("get_user_profile", {
                        p_user_id: userToData.id,
                    });

                    console.log(error);

                    if (data?.length! < 1) {
                        return new JsonResponse({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: {
                                embeds: [{
                                    title: `Error!`,
                                    description: `User <@${member.value}> hasn't used HelpedBy:tm: system!`,
                                    color: 0xdd0000,
                                }],
                            },
                        });
                    }

                    const rank = data?.[0].rank ?? "UNKNOWN";
                    const totalPoints = data?.[0].total_points ?? 0;
                    const givenPoints = data?.[0].given_points ?? 0;

                    return new JsonResponse({
                        type: InteractionResponseType.ChannelMessageWithSource,
                        data: {
                            embeds: [{
                                title: `${userToData.global_name ?? userToData.username}'s HelpedBy:tm: Profile`,
                                description: `\n- **Obtained HelpPoints:tm:: ${totalPoints}**\n- **Given HelpPoints:tm:: ${givenPoints}**`,
                                color: 0xabdd64,
                                thumbnail: {
                                    url: `https://cdn.discordapp.com/avatars/${userToData.id}/${userToData.avatar}.png`,
                                },
                                footer: {
                                    text: `Top #${rank} in the server`
                                }
                            }],
                        },
                    });
                }

                const leaderboardSubcommand = interaction.data.options?.find(
                    (o) => o.name === "leaderboard",
                );

                if (leaderboardSubcommand && leaderboardSubcommand.type === ApplicationCommandOptionType.Subcommand) {
                    const db = getDB(env.SUPABASE_KEY);

                    const { data, error } = await db
                        .rpc("get_leaderboard");

                    if (error) {
                        console.error('RPC error:', error);
                    } else {
                        return new JsonResponse({
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: {
                                embeds: [{
                                    title: `Obtained HelpPoints:tm: Scoreboard`,
                                    description: `${data.map((usr) => `- **#${usr.rank}** - <@${usr.user_id}> with **${usr.total_points}** HelpPoints:tm:`).join("\n")}`,
                                    color: 0xabdd64,
                                }],
                            },
                        });
                    }
                }


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

async function verifyDiscordRequest(request: Request, env: Env) {
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
    // Cron trigger: makes sure the welcome gateway connection is alive.
    async scheduled(_event: ScheduledController, env: Env) {
        const response = await env.WELCOME_GATEWAY.get(env.WELCOME_GATEWAY.idFromName("main"))
            .fetch("https://welcome/");
        if (!response.ok) {
            console.warn("[gateway] cron status:", await response.text());
        }
    },
};

export { WelcomeGateway } from "./welcome.js";
export default server;
