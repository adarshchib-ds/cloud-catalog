import { GoogleAuth } from 'google-auth-library';

// Reads GOOGLE_APPLICATION_CREDENTIALS from the environment (Application Default Credentials)
let authClient: GoogleAuth | null = null;

export function getGcpAuth(): GoogleAuth {
  if (!authClient) {
    authClient = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  return authClient;
}

export async function getGcpAccessToken(): Promise<string> {
  const client = await getGcpAuth().getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error('Failed to obtain GCP access token from Application Default Credentials.');
  }
  return token;
}

export function getGcpProjectId(): string {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error('GCP_PROJECT_ID env var is required for GCP sync');
  }
  return projectId;
}
