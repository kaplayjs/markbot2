import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import dotenv from "dotenv";
import process from "node:process";
import { ABOUT_CMD, API_CMD, HELPEDBY_CMD, KAT_CMD } from "../commands.ts";

/**
 * This file is meant to be run from the command line, and is not used by the
 * application server.  It's allowed to use node.js primitives, and only needs
 * to be run once.
 */

const production = process.argv.includes("--prod");
const credentialsPath = production ? ".vars" : ".dev.vars";
dotenv.config({ path: credentialsPath });

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

await rest.put(Routes.applicationCommands(applicationId), {
    body: [KAT_CMD, ABOUT_CMD, API_CMD, HELPEDBY_CMD],
}).then((r) => {
    console.log(`Registered ${production ? "production" : "preview"} global commands for ${applicationId}`);
    console.log(JSON.stringify(r, null, 2));
});
