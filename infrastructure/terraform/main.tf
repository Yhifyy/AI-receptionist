terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "voicedesk-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "voicedesk-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "VoiceDesk"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# VPC and Networking
module "vpc" {
  source = "./modules/vpc"

  environment = var.environment
  vpc_cidr    = var.vpc_cidr
}

# RDS PostgreSQL
module "rds" {
  source = "./modules/rds"

  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  db_instance_class  = var.db_instance_class
  db_name            = "voicedesk"
}

# ElastiCache Redis
module "elasticache" {
  source = "./modules/elasticache"

  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  node_type          = var.redis_node_type
}

# S3 Bucket for recordings
module "s3" {
  source = "./modules/s3"

  environment = var.environment
  bucket_name = "voicedesk-recordings-${var.environment}"
}

# ECS Cluster and Services
module "ecs" {
  source = "./modules/ecs"

  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  public_subnet_ids  = module.vpc.public_subnet_ids
  
  api_image          = var.api_image
  dashboard_image    = var.dashboard_image
  
  database_url       = module.rds.connection_string
  redis_url          = module.elasticache.connection_string
  s3_bucket          = module.s3.bucket_name
  
  api_cpu            = var.api_cpu
  api_memory         = var.api_memory
  api_desired_count  = var.api_desired_count
}

# Application Load Balancer
module "alb" {
  source = "./modules/alb"

  environment       = var.environment
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_arn   = var.certificate_arn
}

# CloudWatch Monitoring
module "monitoring" {
  source = "./modules/monitoring"

  environment = var.environment
  ecs_cluster = module.ecs.cluster_name
  alb_arn     = module.alb.alb_arn
  rds_id      = module.rds.instance_id
}
