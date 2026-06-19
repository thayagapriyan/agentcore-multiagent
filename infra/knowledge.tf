# The knowledge agent (iter 8) — fourth instantiation of the reusable agent module,
# and the FIRST that serves the MCP protocol instead of HTTP /invocations. It exposes
# a deterministic kb_lookup tool that the researcher agent calls over MCP across the
# runtime boundary (the project's first runtime-to-runtime call). Internal only — no
# A2A door (the plan keeps internal sub-agents off A2A). Entirely additive: its own
# ECR repo + runtime + IAM role; supervisor/router/critic are untouched. Rollback:
# `terraform destroy -target=module.knowledge` (+ the Cognito resources below) leaves
# the other agents running.
#
# Inbound auth: AgentCore Runtime has no no-auth mode (SigV4 is the floor) and the
# Strands McpClient transport can't SigV4-sign, so the MCP runtime uses a Cognito JWT
# authorizer (the same mechanism as every A2A door in this repo). The researcher mints
# a bearer token for this pool and passes it to McpClient via headers.

resource "aws_cognito_user_pool" "knowledge_mcp" {
  name = "${var.knowledge_agent_name}-mcp"

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }
}

resource "aws_cognito_user_pool_client" "knowledge_mcp" {
  name         = "${var.knowledge_agent_name}-mcp-client"
  user_pool_id = aws_cognito_user_pool.knowledge_mcp.id

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity = 1
  token_validity_units {
    access_token = "hours"
  }
}

# Machine identity the researcher authenticates as (USER_PASSWORD_AUTH — the same flow
# the get-a2a-token workflow uses). Not a human tester; the researcher runtime holds
# these credentials via env and mints a token at boot.
resource "random_password" "knowledge_mcp_bot" {
  length      = 20
  special     = false
  min_upper   = 2
  min_lower   = 2
  min_numeric = 2
}

resource "aws_cognito_user" "knowledge_mcp_bot" {
  user_pool_id = aws_cognito_user_pool.knowledge_mcp.id
  username     = "researcher-kb-bot"
  password     = random_password.knowledge_mcp_bot.result

  message_action = "SUPPRESS"
}

# server_protocol = "MCP" flips the runtime's inbound contract; the JWT authorizer
# gates it to this pool's bearer tokens. No bedrock:InvokeModel is needed (the tool is
# pure/deterministic), but the module's baseline role grants it harmlessly — kept
# uniform across agents.
module "knowledge" {
  source = "./modules/agent"

  agent_name = var.knowledge_agent_name
  model_id   = var.model_id
  # One pipeline run tags every image with the same git sha; knowledge_image_tag
  # overrides only if you need to pin the knowledge agent independently.
  image_tag       = var.knowledge_image_tag != "" ? var.knowledge_image_tag : var.image_tag
  account_id      = data.aws_caller_identity.current.account_id
  description     = "Multi-agent knowledge specialist — MCP server exposing a deterministic kb_lookup tool (internal, called over MCP)"
  server_protocol = "MCP"

  jwt_authorizer = {
    discovery_url   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.knowledge_mcp.id}/.well-known/openid-configuration"
    allowed_clients = [aws_cognito_user_pool_client.knowledge_mcp.id]
  }
}

# --- Outputs: the researcher consumes these (wired in researcher.tf), and the deploy
# smoke test uses the MCP URL + token to prove the hop.

output "knowledge_ecr_repository_url" {
  description = "Push knowledge images here"
  value       = module.knowledge.ecr_repository_url
}

output "knowledge_runtime_arn" {
  description = "Knowledge MCP runtime ARN (also in runtime_arns[\"knowledge\"])"
  value       = module.knowledge.agent_runtime_arn
}

# The MCP endpoint the researcher's McpClient POSTs to. AgentCore exposes a runtime
# under its invocations URL; the knowledge app serves MCP at the /mcp path.
output "knowledge_mcp_url" {
  description = "Knowledge agent's MCP endpoint (POST JSON-RPC here)"
  value       = "https://bedrock-agentcore.${var.aws_region}.amazonaws.com/runtimes/${urlencode(module.knowledge.agent_runtime_arn)}/invocations/mcp"
}

output "knowledge_mcp_cognito_client_id" {
  description = "Cognito app client id for the knowledge MCP door"
  value       = aws_cognito_user_pool_client.knowledge_mcp.id
}

output "knowledge_mcp_bot_username" {
  description = "Cognito machine-identity username the researcher authenticates as"
  value       = aws_cognito_user.knowledge_mcp_bot.username
}

output "knowledge_mcp_bot_password" {
  description = "Password for the knowledge MCP machine identity (terraform output -raw knowledge_mcp_bot_password)"
  value       = random_password.knowledge_mcp_bot.result
  sensitive   = true
}
