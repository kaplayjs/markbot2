import {
    ApplicationCommandOptionType,
    type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const KAT_CMD: RESTPostAPIChatInputApplicationCommandsJSONBody = {
    name: "kat",
    description: "Get a cute cat gif.",
};

export const ABOUT_CMD: RESTPostAPIChatInputApplicationCommandsJSONBody = {
    name: "about",
    description: "About this bot.",
};

export const API_CMD: RESTPostAPIChatInputApplicationCommandsJSONBody = {
    name: "api",
    description: "Get information about KAPLAY API.",
    options: [
        {
            name: "query",
            description:
                "The API method to get info. Use \"TypeName\" or \"ctx.methodName\".",
            type: ApplicationCommandOptionType.String,
            required: true,
        },
        {
            name: "version",
            description: "API version. Defaults to v4000.",
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: "v3001",
                    value: "v3001",
                },
                {
                    name: "v4000",
                    value: "v4000",
                },
            ],
            required: false,
        },
    ],
};

export const HELPEDBY_CMD: RESTPostAPIChatInputApplicationCommandsJSONBody = {
    name: "helped",
    description: "Mark that someone helped you with a task in KAPLAY.",
    options: [
        {
            name: "by",
            description: "Reward someone who helped you.",
            type: ApplicationCommandOptionType.Subcommand,
            options: [{
                name: "member",
                description: "The member who helped you.",
                type: ApplicationCommandOptionType.User,
                required: true,
            }]
        },
        {
            name: "profile",
            description: "Check rewards profile from someone or yours.",
            type: ApplicationCommandOptionType.Subcommand,
            options: [{
                name: "member",
                description: "Member to check.",
                type: ApplicationCommandOptionType.User,
                required: true,
            }]
        },
        {
            name: "help",
            description: "Receive info about HelpedBy iniciative.",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: "leaderboard",
            description: "Get the HelpPoints scoreboard.",
            type: ApplicationCommandOptionType.Subcommand,
        },

    ],
};
