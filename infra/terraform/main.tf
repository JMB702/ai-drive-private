terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

resource "aws_s3_bucket" "assets" {
  bucket = "${var.project_name}-assets-${var.environment}"
}

resource "aws_sqs_queue" "generation_jobs" {
  name = "${var.project_name}-generation-jobs-${var.environment}"
}

resource "aws_db_instance" "postgres" {
  identifier              = "${var.project_name}-postgres-${var.environment}"
  allocated_storage       = 20
  engine                  = "postgres"
  engine_version          = "16.4"
  instance_class          = "db.t4g.micro"
  username                = var.db_username
  password                = var.db_password
  db_name                 = "aidrive"
  skip_final_snapshot     = true
  publicly_accessible     = false
  backup_retention_period = 7
}
