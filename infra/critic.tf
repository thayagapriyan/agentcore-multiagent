# The critic agent (iter 7) — third instantiation of the reusable agent module.
# Generator↔critic reflection loop (draft → critique → revise until approved or
# capped). Entirely additive: its own ECR repo + runtime + IAM role; the supervisor
# and router modules are untouched. Rollback: `terraform destroy -target=module.critic`
# (+ the A2A door in critic-a2a.tf) leaves the other agents running.
module "critic" {
  source = "./modules/agent"

  agent_name = var.critic_agent_name
  model_id   = var.model_id
  # One pipeline run tags every image with the same git sha; critic_image_tag
  # overrides only if you need to pin the critic independently.
  image_tag   = var.critic_image_tag != "" ? var.critic_image_tag : var.image_tag
  account_id  = data.aws_caller_identity.current.account_id
  description = "Multi-agent critic / reflection loop (generator ↔ critic, revise until approved or capped)"

  environment_variables = var.critic_a2a_enabled ? { A2A_ENABLED = "true" } : {}
}
