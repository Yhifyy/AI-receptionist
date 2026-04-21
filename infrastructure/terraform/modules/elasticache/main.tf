variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "node_type" {
  type = string
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "voicedesk-${var.environment}"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "redis" {
  name        = "voicedesk-${var.environment}-redis"
  description = "Security group for ElastiCache Redis"
  vpc_id      = var.vpc_id

  ingress {
    protocol    = "tcp"
    from_port   = 6379
    to_port     = 6379
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "voicedesk-${var.environment}"
  description                = "VoiceDesk Redis cluster"

  node_type                  = var.node_type
  num_cache_clusters         = var.environment == "production" ? 2 : 1
  automatic_failover_enabled = var.environment == "production"
  multi_az_enabled           = var.environment == "production"

  engine                     = "redis"
  engine_version             = "7.0"
  port                       = 6379

  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  snapshot_retention_limit   = 7
  snapshot_window            = "03:00-05:00"
  maintenance_window         = "mon:05:00-mon:07:00"

  tags = {
    Name = "voicedesk-${var.environment}"
  }
}

output "endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "connection_string" {
  value = "redis://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
}
