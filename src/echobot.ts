/*
 * Discord Echobot
 * A Node.js Discord Self-Bot to Copy Messages From One Channel to Another
 *
 * Copyright (C) 2018 Mitch Talmadge (https://github.com/MitchTalmadge)
 * Copyright (C) 2018 bishop-bd (https://github.com/bishop-bd)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import * as fs from 'fs';
import * as Discord from 'discord.js';
import * as winston from 'winston';
import { Client } from "@evex/linejs";
import { Message, TextChannel } from "discord.js";
import { MessageCreateOptions } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { EchobotConfiguration } from './model/configuration.model';
import * as http from "http";
import path = require("path");
import { EchobotRedirect } from "./model/redirect.model";

// Constants
const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "bmp", "svg", "jif", "jfif", "apng"]

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => {
            return `${info.timestamp} [${info.level.toLocaleUpperCase()}]: ${info.message}`;
        })
    ),
    transports: new winston.transports.Console()
});

let config: EchobotConfiguration | null = null;
let discordClient: Client | null = null;

class EchoBot {

    constructor() {
        // Load the configuration file.
        if (!this.loadConfiguration())
            return;

        // Start the web server.
        this.startWebServer();

        // Login to the Discord Client.
        this.loginToDiscord();
    }

    /**
     * Attempts to locate and load the configuration file.
     * @returns True if configuration loaded successfully, false otherwise.
     */
    private loadConfiguration(): boolean {
        if (process.env.ECHOBOT_CONFIG_JSON) {
            // Parse the env var contents as JSON.
            config = JSON.parse(process.env.ECHOBOT_CONFIG_JSON);
        } else {
            logger.error("No configuration could be found. Either create a config.json file or put the config in the ECHOBOT_CONFIG_JSON environment variable.");
            return false;
        }

        // Ensure the config has a Discord token defined.
        if (!config || !config.token) {
            logger.error("The Discord Client token is missing from the configuration file.");
            return false;
        }

        // Validate format of redirects
        if (!config.redirects) { // Ensure redirects exist.
            logger.error("You have not defined any redirects. This bot is useless without them.");
            return false;
        } else if (!Array.isArray(config.redirects)) { // Ensure redirects is an array.
            logger.error("The redirects are not properly formatted (missing array). Please check your configuration.");
            return false;
        } else if (config.redirects.length == 0) { // Ensure we have at least one redirect.
            logger.error("You have not defined any redirects. This bot is useless without them.");
            return false;
        } else {

            // Check each redirect.
            for (let redirect of config.redirects) {

                // Check source.
                if (!redirect.sources || redirect.sources.length == 0) {
                    logger.error("A redirect has no sources.");
                    return false;
                } else if (!Array.isArray(redirect.sources)) {
                    logger.error("A redirect's sources were not formatted as an array.");
                    return false;
                }

                // Check destination.
                if (!redirect.destinations || redirect.destinations.length == 0) {
                    logger.error("A redirect has no destinations.");
                    return false;
                } else if (!Array.isArray(redirect.destinations)) {
                    logger.error("A redirect's destinations were not formatted as an array.");
                    return false;
                }

                // Check for loop.
                for (let source of redirect.sources) {
                    if (!redirect.destinations) {
                        logger.error("A redirect has no destinations.");
                        continue;
                    }
                    for (let destination of redirect.destinations) {
                        if (source == destination) {
                            logger.error("A redirect has a source that is the same as a destination: " + source + ". This will result in an infinite loop.");
                            return false;
                        }
                    }
                }
            }
        }

        // Validation complete.
        logger.info("Configuration loaded successfully.");
        return true;
    }

    /**
     * Starts the web server that accepts ping messages, if the PORT environment variable is defined.
     *
     * The purpose of this server is to allow the bot to be used on PaaS infrastructures like Heroku,
     * which expect applications to bind to a web port -- as well as allowing for uptime monitoring.
     */
    private startWebServer(): void {

        // Ensure PORT env var is defined.
        if (!process.env.PORT || isNaN(Number.parseInt(process.env.PORT)))
            return;

        logger.info("Starting web server on port " + process.env.PORT);

        // Create a server and bind it to the environment variable PORT.
        http.createServer((req, res) => {
            res.write("pong");
            res.end();
        }).listen(process.env.PORT);
    }

    /**
     * Signs into the Discord client with the token in the config,
     * and subscribes to message listeners.
     */
    private loginToDiscord(): void {
        // Create client, but don't login yet.
        const discordClient = new Client({
    intents: [
        Discord.GatewayIntentBits.Guilds, 
        Discord.GatewayIntentBits.GuildMessages, 
        Discord.GatewayIntentBits.MessageContent
    ]
});

        // Register event for when client is ready.
discordClient.once(Discord.Events.ClientReady, () => {
    logger.info("Signed into Discord.");
});

        // Register event for when client receives a message.
        discordClient.on('message', (message) => {
            this.onDiscordClientMessageReceived(message)
                .then(() => logger['debug']("Message handled gracefully."))
                .catch(err => {
                    logger.error("Failed to handle message:")
                    logger.error(err)
                })
        });

        // Showing auth token when logging in using email + pw
        discordClient.on("update:authtoken", (authtoken) => {
            console.log("AuthToken", authtoken);
        });

        // Register event for when an error occurs.
        discordClient.on('error', error => {
            logger.error("An error occurred: " + error.message);
            logger.info("Restarting Discord Client.");
            if (discordClient) {
                discordClient.destroy();
            }
            this.loginToDiscord();
        });

        // Login.
        if (config && config.token) {
            
            discordClient
                .login({
                    email: "discordalternative206@gmail.com",
                    password: "BP204sch",
                })
                .catch(err => {
                    
                    if (config) {
                        logger.error("Could not sign into Discord with " + config.token + ":", err);
                    } else {
                        logger.error("Config is null. Could not sign into Discord:", err);
                    }
                });
        } else {
            logger.error("Config or token is null. Cannot login to Discord.");
        }
    }

    /**
     * Fired when a message is received on Discord in any channel.
     * @param message The message that was received.
     */
    private async onDiscordClientMessageReceived(message: Discord.Message): Promise<void> {
        // Find redirects that have this message's channel id as a source.
        if (!config || !config.redirects) {
            logger.error("Configuration or redirects are not properly loaded.");
            return;
        }
        let matchingRedirects = config.redirects.filter(redirect =>
            redirect.sources?.some(source => source == message.channel.id) ?? false
        );

        // Redirect to each destination.
        for (let redirect of matchingRedirects) {

            // Check allowList
            if (redirect.options && redirect.options.allowList) {
                if (redirect.options.allowList.length > 0) {
                    if (!redirect.options.allowList.includes(message.author.id)) {
                        logger.info("Dropping message from " + message.author.username + " in " + (message.guild ? message.guild.name : "Unknown Guild") + "/" + (message.channel as TextChannel).name + " as their ID (" + message.author.id + ") is not in the allowList.")
                        continue;
                    }
                }
            }

            let header = this.createHeader(message, redirect);
            let body = this.createBody(message, redirect);
            // Check body minLength
            if (redirect.options && redirect.options.minLength) {
                if (!body.embed && (!body.contents || body.contents.length < redirect.options.minLength)) {
                    logger.info(`Dropping message from ${message.author.username} in ${this.explainPath(message.channel)} as their message is too short.`)
                    continue;
                }
            }
            if (!body.contents && !body.embed) {
                logger.info(`Dropping message from ${message.author.username} in ${this.explainPath(message.channel)} as their message would be empty due to redirect options.`)
                continue;
            }
if (redirect.destinations) {
            for (let destination of redirect.destinations) {

                // Find destination channel.
                if (!discordClient) {
                    logger.error("Discord client is null. Cannot redirect message.");
                    return;
                }
                let destChannel = discordClient.channels.cache.get(destination);
                if (destChannel == null) {
                    Promise.reject(`Could not redirect from channel ID ${message.channel.id} to channel ID ${destination}: Destination channel was not found.`);
                    return;
                } else if (!(destChannel instanceof TextChannel)) {
                    Promise.reject(`Could not redirect from channel ID ${message.channel.id} to channel ID ${destination}: Destination channel is not a text channel.`);
                    return;
                }

                logger.info(`Redirecting message by ${message.author.username} from ${this.explainPath(message.channel)} to ${this.explainPath(destChannel)}`);

                // Send the header
                if (header) {
    logger.debug("Sending header:");
    logger.debug(JSON.stringify(header));

    let options: MessageCreateOptions = {
        nonce: this.generateNonce()
    };

    if (header instanceof Discord.EmbedBuilder) {
        options.embeds = [header]; // ✅ Gebruik 'embeds'[] array
        await (destChannel as TextChannel).send(options);
        logger.debug("Sent header as embed.");
    } else {
        await (destChannel as TextChannel).send({ content: String(header), ...options }); // ✅ Zorg dat header een string is
        logger.debug("Sent header as text.");
    }
}

                // Send the body
               logger.debug("Sending body:");
logger.debug(JSON.stringify(body));

let options: Discord.MessageCreateOptions = {
    files: redirect.options?.copyAttachments ? message.attachments.map(attachment => ({
        attachment: attachment.url, 
        name: attachment.name 
    })) : [],
    embeds: body.embed ? [body.embed] : []
};

// Zorg altijd dat een lege string wordt verstuurd als content
await (destChannel as Discord.TextChannel).send({ 
    content: String(body.contents ?? ''), 
    ...options 
});

logger.debug("Sent body.");
        }   
    }else{
            logger.error("No destinations found.")
        }
    }
}

    private generateNonce(): string {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    private explainPath(channel: Discord.Channel): string {
    let parts: string[] = [];

    if (channel.isDMBased()) {  
        parts.push("Direct Messages");
    } 
    else if (channel.isTextBased() && "guild" in channel) { 
        parts.push(channel.guild?.name || "Unknown Guild"); // Voeg Guild naam toe
        if ("parent" in channel && channel.parent?.name) {
            parts.push(channel.parent.name);
        }
        parts.push(channel.name);
    }

    return parts.join(" / ");
}

private createHeader(message: Message, redirect: EchobotRedirect): EmbedBuilder | string | null {
    if (redirect.options && redirect.options.richEmbed) {
        // Sending a rich embed.
        let richEmbed = new EmbedBuilder()
            .setColor(redirect.options.richEmbedColor ? redirect.options.richEmbedColor : 30975);

        if (!redirect.options.title && !redirect.options.includeSource) {
            return null;
        }

        // Add title if requested.
        if (redirect.options.title) {
            richEmbed.setTitle(redirect.options.title);
        }

        // Add source if requested.
        if (redirect.options.includeSource) {
            const displayName = message.member ? message.member.displayName : message.author.username;
            richEmbed.addFields({ name: "Author", value: `**${displayName}** in **${this.explainPath(message.channel)}**` });
        }
        return richEmbed;
    } else {
        // Sending a standard message.
        let destinationMessage = "";

        // Add title if requested.
        if (redirect.options && redirect.options.title) {
            destinationMessage += "**" + redirect.options.title + "**\n";
        }

        // Add source if requested.
        if (redirect.options && redirect.options.includeSource) {
            const displayName = message.member ? message.member.displayName : message.author.username;
            destinationMessage += `*Author: **${displayName}** in **${this.explainPath(message.channel)}***\n`;
        }

        if (destinationMessage == "") {
            return null;
        }
        return destinationMessage;
    }
}

    private createBody(message: Discord.Message, redirect: EchobotRedirect): { contents?: string, embed?: EmbedBuilder } {
    let contents = message.content;
    let embed: EmbedBuilder | null = null;

    // Copy rich embed if requested.
    if (redirect.options && redirect.options.copyRichEmbed) {
        let receivedEmbed = message.embeds.find(e => e.data.type === 'rich'); // Controleer of het een rich embed is
        if (receivedEmbed) {
            embed = new EmbedBuilder()
                .setTitle(receivedEmbed.title || "")
                .setDescription(receivedEmbed.description || "")
                .setURL(receivedEmbed.url || "");

            // Voeg kleur toe als deze bestaat
            if (receivedEmbed.color) {
                embed.setColor(receivedEmbed.color);
            }

            // Voeg een afbeelding toe als deze bestaat
            if (receivedEmbed.image) {
                embed.setImage(receivedEmbed.image.url);
            }

            // Voeg een thumbnail toe als deze bestaat
            if (receivedEmbed.thumbnail) {
                embed.setThumbnail(receivedEmbed.thumbnail.url);
            }

            // Voeg een footer toe indien beschikbaar
            if (receivedEmbed.footer) {
                embed.setFooter({ text: receivedEmbed.footer.text, iconURL: receivedEmbed.footer.iconURL });
            }

            // Voeg tijdstempel toe als dat aanwezig is
            if (receivedEmbed.timestamp) {
                embed.setTimestamp(new Date(receivedEmbed.timestamp));
            }

            // Voeg velden toe als ze er zijn
            if (receivedEmbed.fields) {
                embed.addFields(receivedEmbed.fields.map(field => ({
                    name: field.name,
                    value: field.value,
                    inline: field.inline || false
                })));
            }
        }
    }

    // Remove @everyone if requested.
    if (redirect.options && redirect.options.removeEveryone) {
        contents = contents.replace("@everyone", "");
    }

    // Remove @here if requested.
    if (redirect.options && redirect.options.removeHere) {
        contents = contents.replace("@here", "");
    }

    return { contents, embed: embed || undefined }; // Embed wordt alleen geretourneerd als deze bestaat
}


    }
    
    // Instantiate the EchoBot
    new EchoBot();
