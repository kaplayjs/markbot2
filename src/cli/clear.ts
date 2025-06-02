import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import dotenv from "dotenv";
import process from "node:process";

dotenv.config({ path: ".dev.vars" });

const token = process.env.DISCORD_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;

if (!token) {
    throw new Error("The DISCORD_TOKEN environment variable is required.");
}
if (!applicationId) {
    throw new Error(
        "The DISCORD_APPLICATION_ID environment variable is required.",
    );
}

const rest = new REST({ version: "10" }).setToken(token);

rest.put(Routes.applicationCommands(applicationId), {
    body: [],
}).then(() => {
    console.log("Bulk deleted global commands");
}).catch((error) => {
    console.error("Error deleting global commands:", error);
});

rest.put(Routes.applicationGuildCommands(applicationId, "883781994583056384"), {
    body: [],
}).then(() => {
    console.log("Bulk deleted guild commands");
}).catch((error) => {
    console.error("Error deleting guild commands:", error);
});
