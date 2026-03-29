import fs from "node:fs";
import path from "node:path";

import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";

import type { BotConfig } from "./config.js";
import type { BotReply, IncomingMessage, MessagePlatformAdapter } from "./types.js";

const MAX_ATTACHMENT_BYTES_PER_FILE = 7_500_000;
const MAX_ATTACHMENT_BYTES_PER_MESSAGE = 7_500_000;

export class DiscordAdapter implements MessagePlatformAdapter {
  private readonly client: Client;
  private started = false;

  constructor(
    private readonly config: Pick<
      BotConfig,
      "discordBotToken" | "discordAllowedChannelIds" | "logLevel"
    >,
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
  }

  async startWatching(handlers: {
    onMessage: (message: IncomingMessage) => Promise<void>;
    onError: (error: Error) => void;
  }): Promise<void> {
    if (this.started) {
      return;
    }

    this.client.on(Events.Error, (error) => {
      handlers.onError(toError(error));
    });

    this.client.on(Events.MessageCreate, async (message) => {
      if (!shouldHandleMessage(message, this.client.user?.id, this.config.discordAllowedChannelIds)) {
        return;
      }

      const incoming = toIncomingMessage(message, this.client.user?.id);
      if (!incoming) {
        return;
      }

      try {
        await handlers.onMessage(incoming);
      } catch (error) {
        handlers.onError(toError(error));
      }
    });

    await this.client.login(this.config.discordBotToken);
    this.started = true;
  }

  async sendReply(chatId: string, reply: BotReply): Promise<void> {
    const channel = await this.client.channels.fetch(chatId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      throw new Error(`Channel is not sendable: ${chatId}`);
    }

    const attachmentPlan = planAttachmentBatches(reply.imagePaths);
    const skippedNotice =
      attachmentPlan.skippedPaths.length > 0
        ? `\n\nSkipped ${attachmentPlan.skippedPaths.length} oversized image${attachmentPlan.skippedPaths.length === 1 ? "" : "s"} because Discord rejected the original file size.`
        : "";
    const primaryContent = `${reply.text.trim()}${skippedNotice}`.trim();

    if (attachmentPlan.batches.length === 0) {
      await channel.send(primaryContent || "No uploadable images were available for this result.");
      return;
    }

    await channel.send(
      buildMessagePayload({
        content: primaryContent,
        imagePaths: attachmentPlan.batches[0]!,
      }),
    );

    for (let index = 1; index < attachmentPlan.batches.length; index += 1) {
      await channel.send(
        buildMessagePayload({
          content: `More images (${index + 1}/${attachmentPlan.batches.length})`,
          imagePaths: attachmentPlan.batches[index]!,
        }),
      );
    }
  }

  async close(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.client.destroy();
    this.started = false;
  }
}

function shouldHandleMessage(
  message: Message,
  botUserId: string | undefined,
  allowedChannelIds: readonly string[],
): boolean {
  if (message.author.bot || message.system) {
    return false;
  }

  if (message.channel.isDMBased()) {
    return true;
  }

  if (allowedChannelIds.includes(message.channelId)) {
    return true;
  }

  return botUserId ? message.mentions.users.has(botUserId) : false;
}

function toIncomingMessage(
  message: Message,
  botUserId: string | undefined,
): IncomingMessage | null {
  const text = sanitizeMessageText(message.content, botUserId);
  if (!text) {
    return null;
  }

  return {
    chatId: message.channelId,
    userId: message.author.id,
    senderName:
      message.member?.displayName ?? message.author.globalName ?? message.author.username,
    text,
    receivedAt: message.createdAt.toISOString(),
  };
}

function sanitizeMessageText(content: string, botUserId: string | undefined): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  if (!botUserId) {
    return trimmed;
  }

  return trimmed.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function planAttachmentBatches(imagePaths: readonly string[]): {
  batches: string[][];
  skippedPaths: string[];
} {
  const batches: string[][] = [];
  const skippedPaths: string[] = [];
  let currentBatch: string[] = [];
  let currentBatchBytes = 0;

  for (const imagePath of imagePaths) {
    const fileSize = fs.statSync(imagePath).size;
    if (fileSize > MAX_ATTACHMENT_BYTES_PER_FILE) {
      skippedPaths.push(imagePath);
      continue;
    }

    if (
      currentBatch.length > 0 &&
      currentBatchBytes + fileSize > MAX_ATTACHMENT_BYTES_PER_MESSAGE
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchBytes = 0;
    }

    currentBatch.push(imagePath);
    currentBatchBytes += fileSize;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return {
    batches,
    skippedPaths,
  };
}

function buildMessagePayload(input: {
  content: string;
  imagePaths: readonly string[];
}): {
  content?: string;
  files: AttachmentBuilder[];
} {
  const payload: {
    content?: string;
    files: AttachmentBuilder[];
  } = {
    files: input.imagePaths.map(
      (imagePath) =>
        new AttachmentBuilder(imagePath, {
          name: path.basename(imagePath),
        }),
    ),
  };

  if (input.content.trim()) {
    payload.content = input.content.trim();
  }

  return payload;
}
