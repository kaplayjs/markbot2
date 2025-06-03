import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord-api-types/v10";

export const KAT_CMD: RESTPostAPIChatInputApplicationCommandsJSONBody = {
    name: "kat",
    description: "Get a cute cat gif.",
};

export const ABOUT_CMD: RESTPostAPIChatInputApplicationCommandsJSONBody = {
    name: "about",
    description: "About this bot.",
};
