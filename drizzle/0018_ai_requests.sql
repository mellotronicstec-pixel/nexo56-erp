CREATE TABLE `ai_requests` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36),
	`requested_by` varchar(36) NOT NULL,
	`task_key` varchar(96) NOT NULL,
	`surface_key` varchar(96) NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`entity_id` varchar(36) NOT NULL,
	`prompt_version` varchar(40) NOT NULL,
	`provider_key` varchar(60),
	`model_key` varchar(120),
	`status` varchar(20) NOT NULL,
	`error_code` varchar(60),
	`input_char_count` int NOT NULL,
	`output_char_count` int,
	`input_tokens` int,
	`output_tokens` int,
	`latency_ms` int,
	`created_at` datetime(3) NOT NULL,
	`completed_at` datetime(3),
	CONSTRAINT `ai_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `ck_ai_request_status` CHECK(status IN ('requested','succeeded','failed','rejected'))
);
--> statement-breakpoint
ALTER TABLE `ai_requests` ADD CONSTRAINT `fk_ai_request_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD CONSTRAINT `fk_ai_request_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD CONSTRAINT `fk_ai_request_requested_by_tenant` FOREIGN KEY (`requested_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_ai_request_tenant_created` ON `ai_requests` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_ai_request_tenant_user_created` ON `ai_requests` (`tenant_id`,`requested_by`,`created_at`);