# The supervisor agent — first instantiation of the reusable agent module.
# Adding another agent type (iter 5+) is just another `module "<type>"` block.
module "supervisor" {
  source = "./modules/agent"

  agent_name  = var.agent_name
  model_id    = var.model_id
  image_tag   = var.image_tag
  account_id  = data.aws_caller_identity.current.account_id
  description = "Multi-agent supervisor (agent-as-tool: math + greeting specialists)"
}

# State migration (iter 3): map the pre-refactor root resources to their new
# addresses inside module.supervisor so `terraform apply` MOVES them rather than
# destroying/recreating the live runtime. Reversible — removing these blocks (and
# restoring the old root resources) rolls back.
moved {
  from = aws_ecr_repository.agent
  to   = module.supervisor.aws_ecr_repository.this
}

moved {
  from = aws_ecr_lifecycle_policy.agent
  to   = module.supervisor.aws_ecr_lifecycle_policy.this
}

moved {
  from = aws_iam_role.agent_runtime
  to   = module.supervisor.aws_iam_role.runtime
}

moved {
  from = aws_iam_role_policy.ecr_pull
  to   = module.supervisor.aws_iam_role_policy.ecr_pull
}

moved {
  from = aws_iam_role_policy.logs
  to   = module.supervisor.aws_iam_role_policy.logs
}

moved {
  from = aws_iam_role_policy.bedrock_invoke
  to   = module.supervisor.aws_iam_role_policy.bedrock_invoke
}

moved {
  from = aws_bedrockagentcore_agent_runtime.supervisor
  to   = module.supervisor.aws_bedrockagentcore_agent_runtime.this
}
