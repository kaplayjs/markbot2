import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord-api-types/v10";

export const AWW_COMMAND: RESTPostAPIChatInputApplicationCommandsJSONBody = {
    name: "kat",
    description: "Get a cute cat gif.",
};

export const INVITE_COMMAND: RESTPostAPIChatInputApplicationCommandsJSONBody = {
    name: "invite",
    description: "Get an invite link to add the bot to your server",
};
