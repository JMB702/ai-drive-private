import { ApiClient } from "@aidrive/sdk";

const client = new ApiClient({
  baseUrl: process.env.AIDRIVE_API_URL ?? "http://localhost:4000",
  userId: process.env.AIDRIVE_USER_ID ?? "user_demo"
});

export async function listWorkspaceAssetsDemo(workspaceId: string): Promise<void> {
  const workspaces = await client.listWorkspaces();
  const found = workspaces.workspaces.some((w) => w.id === workspaceId);
  if (!found) {
    throw new Error("Workspace not found for plugin user");
  }
}
