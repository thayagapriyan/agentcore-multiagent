# A second A2A door for the supervisor, from the SAME image: server_protocol =
# A2A with NO custom authorizer, so inbound auth is AgentCore's default SigV4.
# This exists for the MuleSoft Agent Registry scanner: its IAM policy carries
# bedrock-agentcore:InvokeAgentRuntime, i.e. it fetches the agent card with
# SigV4-signed requests — which the JWT-only A2A runtime (supervisor-a2a.tf)
# rejects. Bearer-token clients (the a2d-ai tester) keep using the JWT runtime;
# nothing existing changes. Note "no authentication" in the public sense is not
# possible on AgentCore Runtime — SigV4 is the floor — but SigV4 is exactly what
# the scanner's access keys can sign.
# Rollback: terraform destroy -target on this file's resources.

resource "aws_bedrockagentcore_agent_runtime" "supervisor_a2a_sigv4" {
  agent_runtime_name = "${replace(var.agent_name, "-", "_")}_a2a_sigv4"
  description        = "Supervisor over A2A protocol (SigV4 inbound auth — scanner-discoverable)"
  role_arn           = module.supervisor.runtime_role_arn

  agent_runtime_artifact {
    container_configuration {
      container_uri = "${module.supervisor.ecr_repository_url}:${var.image_tag}"
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  protocol_configuration {
    server_protocol = "A2A"
  }

  environment_variables = merge(
    {
      LOG_LEVEL      = "info"
      MODEL_ID       = var.model_id
      A2A_ENABLED    = "true"
      LOG_DELEGATION = "true"
    },
    # Manual card-URL override only. Normally unnecessary: AgentCore injects
    # AGENTCORE_RUNTIME_URL into the container and the card self-corrects on
    # deploy (verified live in iter-4).
    var.supervisor_a2a_sigv4_public_url == "" ? {} : { AGENTCORE_RUNTIME_URL = var.supervisor_a2a_sigv4_public_url },
  )
}

output "a2a_sigv4_runtime_arn" {
  description = "ARN of the supervisor's SigV4 A2A runtime (the one the MuleSoft scanner can read end-to-end)"
  value       = aws_bedrockagentcore_agent_runtime.supervisor_a2a_sigv4.agent_runtime_arn
}

output "a2a_sigv4_endpoint_url" {
  description = "SigV4 A2A endpoint (agent card at .well-known/agent-card.json under it; requests must be SigV4-signed)"
  value       = "https://bedrock-agentcore.${var.aws_region}.amazonaws.com/runtimes/${urlencode(aws_bedrockagentcore_agent_runtime.supervisor_a2a_sigv4.agent_runtime_arn)}/invocations/"
}
