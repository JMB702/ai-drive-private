import { ApiClient } from "@aidrive/sdk";

const client = new ApiClient({
  baseUrl: process.env.AIDRIVE_API_URL ?? "http://localhost:4000",
  userId: process.env.AIDRIVE_USER_ID ?? "user_demo"
});

export async function fetchJobsForNotifications(workspaceId: string) {
  return client.listGenerationJobs(workspaceId);
}
