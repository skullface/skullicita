import { appendNote } from "../lib/notes";
import { connectPhotonCredentials } from "@vercel/connect/eve";
import { photonIMessageChannel } from "eve/channels/photon";

export const photonCredentials = connectPhotonCredentials("photon/skullicita");

const NTS_PREFIX = /^nts(?:\s+|$)/i;
const NTS_ACK_EMOJI = "✍️";

type IMessageSidecar = {
  markRead(threadId: string, messageId: string): Promise<void>;
  addReaction(
    threadId: string,
    messageId: string,
    emoji: string,
  ): Promise<void>;
};

export default photonIMessageChannel({
  credentials: photonCredentials,
  async onMessage(ctx, message) {
    const text = message.text?.trim() ?? "";
    if (!NTS_PREFIX.test(text)) {
      return { auth: null };
    }

    const body = text.replace(NTS_PREFIX, "").trim();

    try {
      await appendNote({
        text: body,
        sender: message.author.fullName,
        messageId: message.id,
      });

      const adapter = ctx.thread.adapter as IMessageSidecar;
      await adapter.markRead(ctx.thread.id, message.id);
      await adapter.addReaction(ctx.thread.id, message.id, NTS_ACK_EMOJI);
    } catch (error) {
      console.error("[photon] failed to capture nts note", error);
    }

    return null;
  },
});
