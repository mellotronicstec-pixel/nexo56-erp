CREATE TABLE `automation_action_attempts` (
	`id` varchar(36) NOT NULL,
	`execution_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`action_index` int unsigned NOT NULL,
	`attempt_number` int unsigned NOT NULL,
	`status` varchar(20) NOT NULL,
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	`error_code` varchar(60),
	`error_summary` varchar(500),
	`domain_result_ref` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `automation_action_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_automation_action_attempt` UNIQUE(`execution_id`,`action_index`,`attempt_number`),
	CONSTRAINT `ck_automation_action_attempt_status` CHECK(status IN ('running','succeeded','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE `automation_executions` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`rule_id` varchar(36) NOT NULL,
	`rule_version_id` varchar(36) NOT NULL,
	`trigger_kind` varchar(20) NOT NULL,
	`trigger_ref` varchar(190) NOT NULL,
	`idempotency_key` varchar(240) NOT NULL,
	`status` varchar(20) NOT NULL,
	`input_snapshot` json NOT NULL,
	`started_at` datetime(3),
	`completed_at` datetime(3),
	`error_summary` varchar(500),
	`correlation_id` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `automation_executions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_automation_execution_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `uq_automation_execution_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `ck_automation_execution_status` CHECK(status IN ('skipped','running','succeeded','failed')),
	CONSTRAINT `ck_automation_execution_trigger_kind` CHECK(trigger_kind IN ('domain_event','schedule'))
);
--> statement-breakpoint
CREATE TABLE `automation_rule_units` (
	`rule_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	CONSTRAINT `automation_rule_units_rule_id_unit_id_pk` PRIMARY KEY(`rule_id`,`unit_id`)
);
--> statement-breakpoint
CREATE TABLE `automation_rule_versions` (
	`id` varchar(36) NOT NULL,
	`rule_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`version_number` int unsigned NOT NULL,
	`trigger_kind` varchar(20) NOT NULL,
	`trigger_key` varchar(80) NOT NULL,
	`definition` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`created_by` varchar(36),
	CONSTRAINT `automation_rule_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_automation_rule_version_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `uq_automation_rule_version_number` UNIQUE(`rule_id`,`version_number`),
	CONSTRAINT `ck_automation_rule_version_trigger_kind` CHECK(trigger_kind IN ('domain_event','schedule'))
);
--> statement-breakpoint
CREATE TABLE `automation_rules` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`scope_kind` varchar(20) NOT NULL,
	`current_version_id` varchar(36),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`archived_at` datetime(3),
	`archived_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `automation_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_automation_rule_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_automation_rule_scope_kind` CHECK(scope_kind IN ('UNIT_SET','TENANT_WIDE'))
);
--> statement-breakpoint
ALTER TABLE `automation_action_attempts` ADD CONSTRAINT `fk_automation_action_attempt_execution_tenant` FOREIGN KEY (`execution_id`,`tenant_id`) REFERENCES `automation_executions`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `automation_executions` ADD CONSTRAINT `fk_automation_execution_rule_tenant` FOREIGN KEY (`rule_id`,`tenant_id`) REFERENCES `automation_rules`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `automation_executions` ADD CONSTRAINT `fk_automation_execution_version_tenant` FOREIGN KEY (`rule_version_id`,`tenant_id`) REFERENCES `automation_rule_versions`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `automation_rule_units` ADD CONSTRAINT `fk_automation_rule_unit_rule_tenant` FOREIGN KEY (`rule_id`,`tenant_id`) REFERENCES `automation_rules`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `automation_rule_units` ADD CONSTRAINT `fk_automation_rule_unit_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `automation_rule_versions` ADD CONSTRAINT `fk_automation_rule_version_rule_tenant` FOREIGN KEY (`rule_id`,`tenant_id`) REFERENCES `automation_rules`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `automation_rules` ADD CONSTRAINT `fk_automation_rule_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `automation_rules` ADD CONSTRAINT `fk_automation_rule_created_by_tenant` FOREIGN KEY (`created_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_automation_action_attempt_execution` ON `automation_action_attempts` (`tenant_id`,`execution_id`);--> statement-breakpoint
CREATE INDEX `ix_automation_execution_rule` ON `automation_executions` (`tenant_id`,`rule_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_automation_execution_status` ON `automation_executions` (`status`);--> statement-breakpoint
CREATE INDEX `ix_automation_rule_unit_tenant` ON `automation_rule_units` (`tenant_id`,`unit_id`);--> statement-breakpoint
CREATE INDEX `ix_automation_rule_version_trigger` ON `automation_rule_versions` (`trigger_key`);--> statement-breakpoint
CREATE INDEX `ix_automation_rule_tenant_enabled` ON `automation_rules` (`tenant_id`,`enabled`);