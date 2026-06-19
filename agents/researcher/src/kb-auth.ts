// MCP inbound auth for the knowledge runtime (iter 8). AgentCore Runtime has no
// "no-auth" mode — its floor is SigV4 — and the Strands McpClient transport makes
// UNSIGNED HTTPS calls (it can't SigV4-sign; the sibling project learned this on its
// Gateway). So the knowledge MCP runtime uses a Cognito JWT authorizer (the same
// mechanism as every A2A door in this repo), and the researcher mints a bearer token
// and passes it to McpClient via static `headers`.
//
// The token is minted with Cognito USER_PASSWORD_AUTH — the exact flow the repo's
// get-a2a-token workflow already uses — over plain HTTPS fetch, so no AWS SDK
// dependency is added. Pure/dependency-light: the config resolver and the InitiateAuth
// request builder are unit-testable; the network call is isolated behind fetch.

export interface KbAuthConfig {
  /** Cognito app client id for the knowledge MCP pool. */
  clientId: string;
  /** Cognito test user (machine identity) username. */
  username: string;
  /** That user's password. */
  password: string;
  /** AWS region (Cognito IDP endpoint). */
  region: string;
}

// Resolve the knowledge-MCP auth config from env. Returns undefined unless ALL fields
// are present — partial config means "auth not wired", so the caller degrades to no
// auth header (and the JWT-gated runtime will simply reject, surfaced as 0 tools).
// Exported + env-injectable so it's unit-testable without real Cognito.
export function resolveKbAuthConfig(env: NodeJS.ProcessEnv = process.env): KbAuthConfig | undefined {
  const clientId = env.KB_MCP_CLIENT_ID?.trim();
  const username = env.KB_MCP_USERNAME?.trim();
  const password = env.KB_MCP_PASSWORD?.trim();
  const region = (env.AWS_REGION ?? 'us-east-1').trim();
  if (clientId && username && password) {
    return { clientId, username, password, region };
  }
  return undefined;
}

// Build the Cognito InitiateAuth (USER_PASSWORD_AUTH) request: endpoint, headers, body.
// Pure — exported so the request shape is unit-testable without a network call.
export function buildInitiateAuthRequest(config: KbAuthConfig): {
  url: string;
  headers: Record<string, string>;
  body: string;
} {
  return {
    url: `https://cognito-idp.${config.region}.amazonaws.com/`,
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.clientId,
      AuthParameters: { USERNAME: config.username, PASSWORD: config.password },
    }),
  };
}

// Mint a Cognito access token (JWT) for the knowledge MCP door. Returns the raw JWT,
// or throws — the caller decides whether to degrade (continueOnError keeps the agent
// answering with 0 remote tools).
export async function mintKbToken(config: KbAuthConfig): Promise<string> {
  const { url, headers, body } = buildInitiateAuthRequest(config);
  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new Error(`Cognito InitiateAuth failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { AuthenticationResult?: { AccessToken?: string } };
  const token = json.AuthenticationResult?.AccessToken;
  if (!token) throw new Error('Cognito InitiateAuth returned no AccessToken');
  return token;
}
