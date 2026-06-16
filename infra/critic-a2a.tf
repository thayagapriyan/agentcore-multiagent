# The critic's public A2A door (iter 7): a SECOND runtime from the critic's image,
# with server_protocol = A2A and OAuth/JWT inbound auth, so browser A2A clients
# (e.g. the a2d-ai tester) can call it with a bearer token. The critic's HTTP
# runtime — and its SigV4 /invocations contract — is untouched; this file is
# additive and rolls back with `terraform destroy -target` on these resources.
# Mirrors router-a2a.tf with its own Cognito pool, so the agents' tokens never
# overlap. (A SigV4 A2A door, like the supervisor's, can be a later follow-up.)

resource "aws_cognito_user_pool" "critic_a2a" {
  name = "${var.critic_agent_name}-a2a"

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }
}

resource "aws_cognito_user_pool_client" "critic_a2a" {
  name         = "${var.critic_agent_name}-a2a-client"
  user_pool_id = aws_cognito_user_pool.critic_a2a.id

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity = 1
  token_validity_units {
    access_token = "hours"
  }
}

resource "random_password" "critic_a2a_tester" {
  length      = 20
  special     = false
  min_upper   = 2
  min_lower   = 2
  min_numeric = 2
}

resource "aws_cognito_user" "critic_a2a_tester" {
  user_pool_id = aws_cognito_user_pool.critic_a2a.id
  username     = "critic-a2a-tester"
  password     = random_password.critic_a2a_tester.result

  message_action = "SUPPRESS"
}

# The A2A runtime. Same image and execution role as the critic's HTTP runtime; the
# container starts the A2A listener via A2A_ENABLED and AgentCore routes external
# traffic to port 9000. JWT authorizer means bearer tokens only — SigV4
# invoke-agent-runtime does NOT work against this runtime.
resource "aws_bedrockagentcore_agent_runtime" "critic_a2a" {
  agent_runtime_name = "${replace(var.critic_agent_name, "-", "_")}_a2a"
  description        = "Critic over A2A protocol (public door — JWT inbound auth)"
  role_arn           = module.critic.runtime_role_arn

  agent_runtime_artifact {
    container_configuration {
      container_uri = "${module.critic.ecr_repository_url}:${var.critic_image_tag != "" ? var.critic_image_tag : var.image_tag}"
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
      discovery_url   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.critic_a2a.id}/.well-known/openid-configuration"
      allowed_clients = [aws_cognito_user_pool_client.critic_a2a.id]
    }
  }

  environment_variables = merge(
    {
      LOG_LEVEL      = "info"
      MODEL_ID       = var.model_id
      A2A_ENABLED    = "true"
      LOG_DELEGATION = "true"
    },
    var.critic_a2a_public_url == "" ? {} : { AGENTCORE_RUNTIME_URL = var.critic_a2a_public_url },
  )
}

# --- Convenience outputs for calling the critic's A2A endpoint.

output "critic_a2a_runtime_arn" {
  description = "ARN of the critic's A2A-protocol runtime"
  value       = aws_bedrockagentcore_agent_runtime.critic_a2a.agent_runtime_arn
}

output "critic_a2a_endpoint_url" {
  description = "Public A2A endpoint for the critic (POST JSON-RPC here; agent card at .well-known/agent-card.json under it)"
  value       = "https://bedrock-agentcore.${var.aws_region}.amazonaws.com/runtimes/${urlencode(aws_bedrockagentcore_agent_runtime.critic_a2a.agent_runtime_arn)}/invocations/"
}

output "critic_a2a_cognito_client_id" {
  description = "Cognito app client id for the critic's A2A door — get a bearer token via cognito-idp initiate-auth (USER_PASSWORD_AUTH)"
  value       = aws_cognito_user_pool_client.critic_a2a.id
}

output "critic_a2a_tester_username" {
  description = "Cognito test user for the critic's A2A door"
  value       = aws_cognito_user.critic_a2a_tester.username
}

output "critic_a2a_tester_password" {
  description = "Password for the critic's A2A test user (terraform output -raw critic_a2a_tester_password)"
  value       = random_password.critic_a2a_tester.result
  sensitive   = true
}
