# Reusable per-agent deployable: ECR repo + AgentCore runtime + runtime IAM role.
# Instantiated once per agent type by the root infra. Resource bodies are byte-for-
# byte the originals from the pre-iter-3 root stack; only the addresses changed
# (handled by `moved {}` blocks in the root), so this refactor recreates nothing.

resource "aws_ecr_repository" "this" {
  name                 = var.agent_name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep only 10 most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# Trust policy — AgentCore Runtime assumes this role
data "aws_iam_policy_document" "agentcore_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
}

resource "aws_iam_role" "runtime" {
  name               = "${var.agent_name}-runtime-role"
  assume_role_policy = data.aws_iam_policy_document.agentcore_trust.json
}

# Runtime perms: pull image from ECR, write logs, invoke the Bedrock model. No
# Gateway or S3 sessions yet. Later iterations APPEND new aws_iam_role_policy
# resources to the agent that needs them — never edit these.

resource "aws_iam_role_policy" "ecr_pull" {
  role = aws_iam_role.runtime.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role_policy" "logs" {
  role = aws_iam_role.runtime.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "arn:aws:logs:*:*:log-group:/aws/bedrock-agentcore/*"
    }]
  })
}

# Invoke the Bedrock model. Strands uses the Converse *Stream* API, so
# InvokeModelWithResponseStream is required alongside InvokeModel. The default
# model (Claude Haiku 4.5) is inference-profile-only, so the role needs the
# inference-profile ARNs plus the underlying anthropic foundation models. The
# agent and all its in-process specialists share this one model.
resource "aws_iam_role_policy" "bedrock_invoke" {
  role = aws_iam_role.runtime.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ]
      Resource = [
        "arn:aws:bedrock:*::foundation-model/anthropic.*",
        "arn:aws:bedrock:*:${var.account_id}:inference-profile/*",
        "arn:aws:bedrock:*:${var.account_id}:application-inference-profile/*"
      ]
    }]
  })
}

# AgentCore Runtime. Single deployable per agent — in-process specialists share it.
# A DEFAULT endpoint is created automatically, so invoke-agent-runtime works against
# agent_runtime_arn without a separate endpoint resource.
resource "aws_bedrockagentcore_agent_runtime" "this" {
  agent_runtime_name = replace(var.agent_name, "-", "_")
  description        = var.description
  role_arn           = aws_iam_role.runtime.arn

  agent_runtime_artifact {
    container_configuration {
      container_uri = "${aws_ecr_repository.this.repository_url}:${var.image_tag}"
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  protocol_configuration {
    server_protocol = "HTTP"
  }

  # LOG_LEVEL + MODEL_ID are the baseline; per-agent extras merge on top so later
  # iterations add Gateway/session/A2A config without restructuring the block.
  environment_variables = merge(
    {
      LOG_LEVEL = "info"
      MODEL_ID  = var.model_id
    },
    var.environment_variables,
  )

  depends_on = [
    aws_iam_role_policy.ecr_pull,
    aws_iam_role_policy.logs,
    aws_iam_role_policy.bedrock_invoke,
  ]
}
