// promptfoo custom provider: invokes a deployed AgentCore HTTP runtime via the AWS
// CLI (`aws bedrock-agentcore invoke-agent-runtime`) — the same SigV4 path the
// deploy smoke test uses. We shell out to the CLI rather than add an AWS SDK
// dependency: the CLI is already present in the deploy job, and this keeps the
// eval harness dependency-light (only promptfoo).
//
// The runtime ARN is selected per provider instance from config.agent against the
// `runtime_arns` Terraform output, resolved once and passed in via the
// RUNTIME_ARNS env var (JSON map) so we don't shell `terraform output` per call.
//
// Usage in a promptfooconfig.yaml:
//   providers:
//     - id: file://../../eval/agentcore-provider.js
//       config: { agent: router }

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function runtimeArnFor(agent) {
  const raw = process.env.RUNTIME_ARNS;
  if (!raw) {
    throw new Error(
      'RUNTIME_ARNS env var not set. Export it from Terraform: ' +
        'RUNTIME_ARNS=$(terraform output -json runtime_arns)',
    );
  }
  const map = JSON.parse(raw);
  const arn = map[agent];
  if (!arn) {
    throw new Error(`no runtime ARN for agent "${agent}" in RUNTIME_ARNS (${Object.keys(map).join(', ')})`);
  }
  return arn;
}

export default class AgentCoreProvider {
  constructor(options = {}) {
    this.agent = options.config?.agent;
    if (!this.agent) throw new Error('agentcore-provider: config.agent is required');
    this.region = options.config?.region || process.env.AWS_REGION || 'us-east-1';
    this.providerId = `agentcore:${this.agent}`;
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt) {
    const arn = runtimeArnFor(this.agent);
    const payloadB64 = Buffer.from(JSON.stringify({ prompt })).toString('base64');
    const outFile = `/tmp/promptfoo-${this.agent}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;

    try {
      await execFileAsync('aws', [
        'bedrock-agentcore',
        'invoke-agent-runtime',
        '--agent-runtime-arn', arn,
        '--payload', payloadB64,
        '--region', this.region,
        outFile,
      ]);
      const { readFile, rm } = await import('node:fs/promises');
      const body = await readFile(outFile, 'utf8');
      await rm(outFile, { force: true });
      const parsed = JSON.parse(body);
      // The /invocations contract returns {"result": "..."}.
      return { output: parsed.result ?? body };
    } catch (err) {
      return { error: `invoke-agent-runtime failed for ${this.agent}: ${err.message}` };
    }
  }
}
