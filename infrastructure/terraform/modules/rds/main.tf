variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "db_instance_class" {
  type = string
}

variable "db_name" {
  type = string
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "voicedesk-${var.environment}"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "voicedesk-${var.environment}-db-subnet"
  }
}

resource "aws_security_group" "rds" {
  name        = "voicedesk-${var.environment}-rds"
  description = "Security group for RDS"
  vpc_id      = var.vpc_id

  ingress {
    protocol    = "tcp"
    from_port   = 5432
    to_port     = 5432
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "main" {
  identifier = "voicedesk-${var.environment}"

  engine         = "postgres"
  engine_version = "16.1"
  instance_class = var.db_instance_class

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = "voicedesk"
  password = random_password.db_password.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az               = var.environment == "production"
  publicly_accessible    = false
  deletion_protection    = var.environment == "production"
  skip_final_snapshot    = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "voicedesk-${var.environment}-final" : null

  backup_retention_period = 7
  backup_window          = "03:00-04:00"
  maintenance_window     = "Mon:04:00-Mon:05:00"

  performance_insights_enabled = true
  monitoring_interval         = 60
  monitoring_role_arn         = aws_iam_role.rds_monitoring.arn

  tags = {
    Name = "voicedesk-${var.environment}"
  }
}

resource "aws_iam_role" "rds_monitoring" {
  name = "voicedesk-${var.environment}-rds-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_ssm_parameter" "db_password" {
  name  = "/voicedesk/${var.environment}/db_password"
  type  = "SecureString"
  value = random_password.db_password.result
}

output "endpoint" {
  value = aws_db_instance.main.endpoint
}

output "connection_string" {
  value     = "postgresql://voicedesk:${random_password.db_password.result}@${aws_db_instance.main.endpoint}/${var.db_name}"
  sensitive = true
}

output "instance_id" {
  value = aws_db_instance.main.id
}
