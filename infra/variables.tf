variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "agent_name" {
  description = "Logical name for the supervisor agent — drives ECR repo and IAM role names. Prefixed per agent so future deployables (iter 5) don't collide."
  type        = string
  default     = "multiagent-supervisor"
}

variable "image_tag" {
  description = "ECR image tag to deploy"
  type        = string
  default     = "latest"
}

variable "model_id" {
  description = "Bedrock model id / inference-profile passed to the runtime as MODEL_ID. Haiku 4.5 is inference-profile-only, hence the global. prefix."
  type        = string
  default     = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "supervisor_a2a_enabled" {
  description = "Start the A2A server inside the HTTP supervisor's container (Agent Card + JSON-RPC on A2A_PORT, default 9000). Not externally reachable on the HTTP-protocol runtime — the public A2A door is the separate A2A-protocol runtime in supervisor-a2a.tf."
  type        = bool
  default     = false
}

variable "supervisor_a2a_public_url" {
  description = "Externally reachable URL of the A2A runtime (https://bedrock-agentcore.<region>.amazonaws.com/runtimes/<url-encoded-arn>/invocations/), advertised on the Agent Card. The ARN only exists after the first apply, so: apply once, read a2a_endpoint_url, set this, apply again. Empty = card advertises a placeholder; clients that use the URL they were given (not the card's) work regardless."
  type        = string
  default     = ""
}

variable "supervisor_a2a_sigv4_public_url" {
  description = "Manual override for the Agent Card URL of the SigV4 A2A runtime. Normally leave empty: AgentCore injects AGENTCORE_RUNTIME_URL into the container, so the card advertises the real endpoint without it (see iter-4 findings; mirrors supervisor_a2a_public_url)."
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub owner/repo allowed to assume the CI/CD deploy role via OIDC"
  type        = string
  default     = "thayagapriyan/agentcore-multiagent"
}

# --- Router agent (iter 5) — a second deployable: conditional Graph router.
# Its own ECR repo + runtime via module "router"; the supervisor is untouched.

variable "router_agent_name" {
  description = "Logical name for the router agent — drives its ECR repo and IAM role names. Distinct prefix so it never collides with the supervisor's resources."
  type        = string
  default     = "multiagent-router"
}

variable "router_image_tag" {
  description = "ECR image tag to deploy for the router. Defaults to image_tag so a single pipeline run can tag both agents with the same git sha; override to pin the router independently."
  type        = string
  default     = ""
}

variable "router_a2a_enabled" {
  description = "Start the A2A server inside the router's HTTP container (Agent Card + JSON-RPC on A2A_PORT). Not externally reachable on the HTTP-protocol runtime — the public A2A door is the separate A2A-protocol runtime in router-a2a.tf."
  type        = bool
  default     = false
}

variable "router_a2a_public_url" {
  description = "Manual override for the router's A2A Agent Card URL. Normally leave empty: AgentCore injects AGENTCORE_RUNTIME_URL into the container and the card self-corrects on deploy (mirrors supervisor_a2a_public_url)."
  type        = string
  default     = ""
}

# --- Critic agent (iter 7) — a third deployable: generator↔critic reflection loop.
# Its own ECR repo + runtime via module "critic"; the supervisor and router are
# untouched.

variable "critic_agent_name" {
  description = "Logical name for the critic agent — drives its ECR repo and IAM role names. Distinct prefix so it never collides with the other agents' resources."
  type        = string
  default     = "multiagent-critic"
}

variable "critic_image_tag" {
  description = "ECR image tag to deploy for the critic. Defaults to image_tag so a single pipeline run can tag every agent with the same git sha; override to pin the critic independently."
  type        = string
  default     = ""
}

variable "critic_a2a_enabled" {
  description = "Start the A2A server inside the critic's HTTP container (Agent Card + JSON-RPC on A2A_PORT). Not externally reachable on the HTTP-protocol runtime — the public A2A door is the separate A2A-protocol runtime in critic-a2a.tf."
  type        = bool
  default     = false
}

variable "critic_a2a_public_url" {
  description = "Manual override for the critic's A2A Agent Card URL. Normally leave empty: AgentCore injects AGENTCORE_RUNTIME_URL into the container and the card self-corrects on deploy (mirrors supervisor_a2a_public_url)."
  type        = string
  default     = ""
}

# --- Knowledge agent (iter 8) — a fourth deployable: an MCP server exposing a
# deterministic kb_lookup tool. Internal (no A2A); reached by the researcher over MCP.
# Its own ECR repo + MCP runtime via module "knowledge"; the other agents are untouched.

variable "knowledge_agent_name" {
  description = "Logical name for the knowledge agent — drives its ECR repo and IAM role names. Distinct prefix so it never collides with the other agents' resources."
  type        = string
  default     = "multiagent-knowledge"
}

variable "knowledge_image_tag" {
  description = "ECR image tag to deploy for the knowledge agent. Defaults to image_tag so a single pipeline run can tag every agent with the same git sha; override to pin it independently."
  type        = string
  default     = ""
}

# --- Researcher agent (iter 8) — a fifth deployable: the public caller that calls the
# knowledge agent over MCP. Its own ECR repo + runtime via module "researcher"; the
# other agents are untouched.

variable "researcher_agent_name" {
  description = "Logical name for the researcher agent — drives its ECR repo and IAM role names. Distinct prefix so it never collides with the other agents' resources."
  type        = string
  default     = "multiagent-researcher"
}

variable "researcher_image_tag" {
  description = "ECR image tag to deploy for the researcher. Defaults to image_tag so a single pipeline run can tag every agent with the same git sha; override to pin it independently."
  type        = string
  default     = ""
}

variable "researcher_a2a_enabled" {
  description = "Start the A2A server inside the researcher's HTTP container (Agent Card + JSON-RPC on A2A_PORT). Not externally reachable on the HTTP-protocol runtime — the public A2A door is the separate A2A-protocol runtime in researcher-a2a.tf."
  type        = bool
  default     = false
}

variable "researcher_a2a_public_url" {
  description = "Manual override for the researcher's A2A Agent Card URL. Normally leave empty: AgentCore injects AGENTCORE_RUNTIME_URL into the container and the card self-corrects on deploy (mirrors supervisor_a2a_public_url)."
  type        = string
  default     = ""
}
