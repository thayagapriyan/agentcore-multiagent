# The researcher agent (iter 8) — fifth instantiation of the reusable agent module,
# and the project's first agent that calls ANOTHER runtime over MCP. Its HTTP runtime
# is wired with the knowledge agent's MCP URL + Cognito credentials so it can mint a
# bearer token and call kb_lookup across the runtime boundary. Entirely additive: its
# own ECR repo + runtime + IAM role; supervisor/router/critic/knowledge modules are
# untouched. Rollback: `terraform destroy -target=module.researcher` (+ the A2A door
# in researcher-a2a.tf) leaves the other agents running.
#
# KB_MCP_URL gates the MCP connection (unset → 0 remote tools, always-green). The
# Cognito client id / bot username+password let the researcher mint a JWT for the
# knowledge MCP door (see agents/researcher/src/kb-auth.ts). depends_on the knowledge
# module so the MCP URL resolves to a real runtime at apply time.
module "researcher" {
  source = "./modules/agent"

  agent_name = var.researcher_agent_name
  model_id   = var.model_id
  # One pipeline run tags every image with the same git sha; researcher_image_tag
  # overrides only if you need to pin the researcher independently.
  image_tag   = var.researcher_image_tag != "" ? var.researcher_image_tag : var.image_tag
  account_id  = data.aws_caller_identity.current.account_id
  description = "Multi-agent researcher — answers project-topic questions by calling the knowledge agent over MCP"

  environment_variables = merge(
    {
      KB_MCP_URL       = "https://bedrock-agentcore.${var.aws_region}.amazonaws.com/runtimes/${urlencode(module.knowledge.agent_runtime_arn)}/invocations/mcp"
      KB_MCP_CLIENT_ID = aws_cognito_user_pool_client.knowledge_mcp.id
      KB_MCP_USERNAME  = aws_cognito_user.knowledge_mcp_bot.username
      KB_MCP_PASSWORD  = random_password.knowledge_mcp_bot.result
      LOG_DELEGATION   = "true"
    },
    var.researcher_a2a_enabled ? { A2A_ENABLED = "true" } : {},
  )
}

output "researcher_ecr_repository_url" {
  description = "Push researcher images here"
  value       = module.researcher.ecr_repository_url
}

output "researcher_runtime_arn" {
  description = "Researcher HTTP runtime ARN (also in runtime_arns[\"researcher\"])"
  value       = module.researcher.agent_runtime_arn
}
