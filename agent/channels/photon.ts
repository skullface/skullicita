import { connectPhotonCredentials } from "@vercel/connect/eve";
import { photonIMessageChannel } from "eve/channels/photon";

export const photonCredentials = connectPhotonCredentials("photon/skullicita");

export default photonIMessageChannel({
  credentials: photonCredentials,
});
