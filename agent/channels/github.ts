import { connectGitHubCredentials } from "@vercel/connect/eve";
import { githubChannel, defaultGitHubAuth } from "eve/channels/github";

export default githubChannel({
  botName: "skullicita",
  credentials: connectGitHubCredentials("github/skullicita"),
  onPullRequest(ctx, pullRequest) {
    if (pullRequest.action !== "opened") return null;
    return { auth: defaultGitHubAuth(ctx) };
  },
});
