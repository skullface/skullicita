import { appendNote } from "../lib/notes";
import { connectPhotonCredentials } from "@vercel/connect/eve";
import { photonIMessageChannel } from "eve/channels/photon";

export const photonCredentials = connectPhotonCredentials("photon/skullicita");

const NTS_PREFIX = /^nts(?:\s+|$)/i;
// iMessage tapbacks only support native reactions (like, love, laugh, …), not arbitrary emoji.
const NTS_ACK_TAPBACK = "like";

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
    } catch (error) {
      console.error("[photon] failed to capture nts note", error);
      return null;
    }

    const adapter = ctx.thread.adapter as IMessageSidecar;
    try {
      await adapter.markRead(ctx.thread.id, message.id);
    } catch (error) {
      console.error("[photon] failed to mark nts note read", error);
    }

    try {
      await adapter.addReaction(
        ctx.thread.id,
        message.id,
        NTS_ACK_TAPBACK,
      );
    } catch (error) {
      console.error("[photon] failed to react to nts note", error);
    }

    return null;
  },
});
