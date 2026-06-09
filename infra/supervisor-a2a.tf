# The supervisor's public A2A door (iter 4): a SECOND runtime from the SAME image,
# with server_protocol = A2A and OAuth/JWT inbound auth, so browser A2A clients
# (e.g. the a2d-ai tester) can call it with a bearer token. The original HTTP
# runtime — and its SigV4 /invocations contract — is untouched; this whole file is
# additive and rolls back with `terraform destroy -target` on these resources.

# --- Inbound auth: Cognito user pool, USER_PASSWORD_AUTH (AWS's documented
# pattern for AgentCore JWT inbound auth — no hosted-UI domain needed; one
# `cognito-idp initiate-auth` call yields the bearer token).

resource "aws_cognito_user_pool" "a2a" {
  name = "${var.agent_name}-a2a"

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }
}

resource "aws_cognito_user_pool_client" "a2a" {
  name         = "${var.agent_name}-a2a-client"
  user_pool_id = aws_cognito_user_pool.a2a.id

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Access tokens are what the runtime authorizer validates; keep them short.
  access_token_validity = 1
  token_validity_units {
    access_token = "hours"
  }
}

resource "random_password" "a2a_tester" {
  length  = 20
  special = false
  # Satisfy the pool policy regardless of what randomness produces.
  min_upper   = 2
  min_lower   = 2
  min_numeric = 2
}

resource "aws_cognito_user" "a2a_tester" {
  user_pool_id = aws_cognito_user_pool.a2a.id
  username     = "a2a-tester"
  password     = random_password.a2a_tester.result

  message_action = "SUPPRESS"
}

# --- The A2A runtime. Same image and execution role as the HTTP supervisor; the
# container starts the A2A listener via A2A_ENABLED and AgentCore routes external
# traffic to port 9000 (the A2A protocol contract). JWT authorizer means bearer
# tokens only — SigV4 invoke-agent-runtime does NOT work against this runtime.
resource "aws_bedrockagentcore_agent_runtime" "supervisor_a2a" {
  agent_runtime_name = "${replace(var.agent_name, "-", "_")}_a2a"
  description        = "Supervisor over A2A protocol (public door — JWT inbound auth)"
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

  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.a2a.id}/.well-known/openid-configuration"
      allowed_clients = [aws_cognito_user_pool_client.a2a.id]
    }
  }

  environment_variables = merge(
    {
      LOG_LEVEL      = "info"
      MODEL_ID       = var.model_id
      A2A_ENABLED    = "true"
      LOG_DELEGATION = "true"
    },
    # Card URL: the runtime ARN isn't knowable before the first create (random
    # suffix), so the advertised URL is set on a follow-up apply once known.
    var.supervisor_a2a_public_url == "" ? {} : { AGENTCORE_RUNTIME_URL = var.supervisor_a2a_public_url },
  )
}

# --- Convenience outputs for calling the A2A endpoint.

output "a2a_runtime_arn" {
  description = "ARN of the supervisor's A2A-protocol runtime"
  value       = aws_bedrockagentcore_agent_runtime.supervisor_a2a.agent_runtime_arn
}

output "a2a_endpoint_url" {
  description = "Public A2A endpoint (POST JSON-RPC here; agent card at .well-known/agent-card.json under it)"
  value       = "https://bedrock-agentcore.${var.aws_region}.amazonaws.com/runtimes/${urlencode(aws_bedrockagentcore_agent_runtime.supervisor_a2a.agent_runtime_arn)}/invocations/"
}

output "a2a_cognito_client_id" {
  description = "Cognito app client id — get a bearer token via cognito-idp initiate-auth (USER_PASSWORD_AUTH)"
  value       = aws_cognito_user_pool_client.a2a.id
}

output "a2a_tester_username" {
  description = "Cognito test user for the A2A door"
  value       = aws_cognito_user.a2a_tester.username
}

output "a2a_tester_password" {
  description = "Password for the A2A test user (terraform output -raw a2a_tester_password)"
  value       = random_password.a2a_tester.result
  sensitive   = true
}
