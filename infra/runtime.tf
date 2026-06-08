# AgentCore Runtime for the supervisor agent. Single deployable — the specialists
# run in-process (agent-as-tool), so there is one runtime, one image.
#
# Real resource name is aws_bedrockagentcore_agent_runtime. A DEFAULT endpoint is
# created automatically, so invoke-agent-runtime works against agent_runtime_arn
# without a separate endpoint resource.

resource "aws_bedrockagentcore_agent_runtime" "supervisor" {
  agent_runtime_name = replace(var.agent_name, "-", "_")
  description        = "Multi-agent supervisor (agent-as-tool: math + greeting specialists)"
  role_arn           = aws_iam_role.agent_runtime.arn

  agent_runtime_artifact {
    container_configuration {
      container_uri = "${aws_ecr_repository.agent.repository_url}:${var.image_tag}"
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  protocol_configuration {
    server_protocol = "HTTP"
  }

  # Keys are appended per iteration — the block is not restructured. The supervisor
  # only needs the model id; Gateway/sessions/orchestration-mode flags arrive in
  # later iterations as optional additions.
  environment_variables = {
    LOG_LEVEL = "info"
    MODEL_ID  = var.model_id
  }

  depends_on = [
    aws_iam_role_policy.ecr_pull,
    aws_iam_role_policy.logs,
    aws_iam_role_policy.bedrock_invoke,
  ]
}
