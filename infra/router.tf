# The router agent (iter 5) — second instantiation of the reusable agent module.
# Conditional Graph router (intake → conditional branch → summarize). Entirely
# additive: its own ECR repo + runtime + IAM role; the supervisor module is
# untouched. Rollback: `terraform destroy -target=module.router` (+ the A2A door
# in router-a2a.tf) leaves the supervisor running.
module "router" {
  source = "./modules/agent"

  agent_name = var.router_agent_name
  model_id   = var.model_id
  # One pipeline run tags both images with the same git sha; router_image_tag
  # overrides only if you need to pin the router independently.
  image_tag   = var.router_image_tag != "" ? var.router_image_tag : var.image_tag
  account_id  = data.aws_caller_identity.current.account_id
  description = "Multi-agent conditional Graph router (intake → billing/tech/general → summarize)"

  environment_variables = var.router_a2a_enabled ? { A2A_ENABLED = "true" } : {}
}
