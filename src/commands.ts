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
