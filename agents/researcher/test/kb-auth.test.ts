import { describe, it, expect } from 'vitest';
import { resolveKbAuthConfig, buildInitiateAuthRequest } from '../src/kb-auth.js';

// Deterministic tests for the knowledge-MCP auth seam — config resolution + the
// Cognito InitiateAuth request shape. No network: mintKbToken's fetch is the only
// impure part and is exercised live in the deploy smoke test, not here. Mirrors the
// repo's "pure seam, network isolated" convention.

describe('resolveKbAuthConfig', () => {
  const full = {
    KB_MCP_CLIENT_ID: 'cid',
    KB_MCP_USERNAME: 'researcher-kb-bot',
    KB_MCP_PASSWORD: 'secret',
    AWS_REGION: 'us-west-2',
  };

  it('returns the config when all fields are present', () => {
    expect(resolveKbAuthConfig(full)).toEqual({
      clientId: 'cid',
      username: 'researcher-kb-bot',
      password: 'secret',
      region: 'us-west-2',
    });
  });

  it('defaults region to us-east-1 when AWS_REGION is unset', () => {
    const { AWS_REGION, ...noRegion } = full;
    expect(resolveKbAuthConfig(noRegion)?.region).toBe('us-east-1');
  });

  it('returns undefined when any required field is missing', () => {
    expect(resolveKbAuthConfig({})).toBeUndefined();
    expect(resolveKbAuthConfig({ KB_MCP_CLIENT_ID: 'cid' })).toBeUndefined();
    expect(
      resolveKbAuthConfig({ KB_MCP_CLIENT_ID: 'cid', KB_MCP_USERNAME: 'u' }),
    ).toBeUndefined();
  });

  it('treats whitespace-only fields as missing', () => {
    expect(
      resolveKbAuthConfig({ ...full, KB_MCP_PASSWORD: '   ' }),
    ).toBeUndefined();
  });
});

describe('buildInitiateAuthRequest', () => {
  const config = { clientId: 'cid', username: 'u', password: 'p', region: 'eu-central-1' };

  it('targets the region-correct Cognito IDP endpoint', () => {
    expect(buildInitiateAuthRequest(config).url).toBe(
      'https://cognito-idp.eu-central-1.amazonaws.com/',
    );
  });

  it('sets the InitiateAuth amz-target and json-1.1 content type', () => {
    const { headers } = buildInitiateAuthRequest(config);
    expect(headers['X-Amz-Target']).toBe('AWSCognitoIdentityProviderService.InitiateAuth');
    expect(headers['Content-Type']).toBe('application/x-amz-json-1.1');
  });

  it('builds a USER_PASSWORD_AUTH body carrying the credentials', () => {
    const body = JSON.parse(buildInitiateAuthRequest(config).body);
    expect(body.AuthFlow).toBe('USER_PASSWORD_AUTH');
    expect(body.ClientId).toBe('cid');
    expect(body.AuthParameters).toEqual({ USERNAME: 'u', PASSWORD: 'p' });
  });
});
