output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "api_endpoint" {
  description = "API endpoint URL"
  value       = module.alb.api_endpoint
}

output "dashboard_endpoint" {
  description = "Dashboard endpoint URL"
  value       = module.alb.dashboard_endpoint
}

output "rds_endpoint" {
  description = "RDS endpoint"
  value       = module.rds.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "Redis endpoint"
  value       = module.elasticache.endpoint
  sensitive   = true
}

output "s3_bucket" {
  description = "S3 bucket for recordings"
  value       = module.s3.bucket_name
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}
