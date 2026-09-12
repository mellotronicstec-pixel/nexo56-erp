CREATE TABLE `tenants` (
	`id` varchar(36) NOT NULL,
	`slug` varchar(64) NOT NULL,
	`name` varchar(160) NOT NULL,
	`status` enum('active','suspended','inactive') NOT NULL DEFAULT 'active',
	`timezone` varchar(64) NOT NULL DEFAULT 'America/Sao_Paulo',
	`plan_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tenants_slug` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`timezone` varchar(64),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `units_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_units_tenant_name` UNIQUE(`tenant_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `user_units` (
	`user_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `user_units_user_id_unit_id_pk` PRIMARY KEY(`user_id`,`unit_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`email` varchar(190) NOT NULL,
	`name` varchar(160) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`status` enum('active','suspended','inactive') NOT NULL DEFAULT 'active',
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_tenant_email` UNIQUE(`tenant_id`,`email`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`last_used_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sessions_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`key` varchar(96) NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` varchar(400) NOT NULL,
	`feature_key` varchar(96) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `permissions_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` varchar(36) NOT NULL,
	`permission_key` varchar(96) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `role_permissions_role_id_permission_key_pk` PRIMARY KEY(`role_id`,`permission_key`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`key` varchar(64) NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` varchar(400) NOT NULL DEFAULT '',
	`is_system` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_roles_tenant_key` UNIQUE(`tenant_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` varchar(36) NOT NULL,
	`role_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `user_roles_user_id_role_id_pk` PRIMARY KEY(`user_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `feature_dependencies` (
	`feature_key` varchar(96) NOT NULL,
	`depends_on_key` varchar(96) NOT NULL,
	CONSTRAINT `feature_dependencies_feature_key_depends_on_key_pk` PRIMARY KEY(`feature_key`,`depends_on_key`)
);
--> statement-breakpoint
CREATE TABLE `features` (
	`key` varchar(96) NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` varchar(400) NOT NULL,
	`type` enum('CORE','OPTIONAL','PREMIUM','BETA','INTERNAL') NOT NULL,
	`status` enum('available','deprecated') NOT NULL DEFAULT 'available',
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `features_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `plan_entitlements` (
	`plan_id` varchar(36) NOT NULL,
	`feature_key` varchar(96) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `plan_entitlements_plan_id_feature_key_pk` PRIMARY KEY(`plan_id`,`feature_key`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` varchar(36) NOT NULL,
	`key` varchar(64) NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` varchar(400) NOT NULL DEFAULT '',
	`is_internal` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_plans_key` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `tenant_features` (
	`tenant_id` varchar(36) NOT NULL,
	`feature_key` varchar(96) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`enabled_at` datetime(3),
	`disabled_at` datetime(3),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `tenant_features_tenant_id_feature_key_pk` PRIMARY KEY(`tenant_id`,`feature_key`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36),
	`unit_id` varchar(36),
	`user_id` varchar(36),
	`action` varchar(96) NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` varchar(36),
	`before` json,
	`after` json,
	`metadata` json,
	`correlation_id` varchar(36),
	`origin` varchar(16) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `domain_events` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36),
	`type` varchar(96) NOT NULL,
	`payload` json NOT NULL,
	`correlation_id` varchar(36),
	`occurred_at` datetime(3) NOT NULL,
	`published_at` datetime(3),
	CONSTRAINT `domain_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` varchar(36) NOT NULL,
	`name` varchar(96) NOT NULL,
	`tenant_id` varchar(36),
	`payload` json NOT NULL,
	`idempotency_key` varchar(190),
	`status` enum('pending','running','succeeded','failed','discarded') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 3,
	`run_after` datetime(3) NOT NULL,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`last_error` varchar(1000),
	`correlation_id` varchar(36),
	`locked_by` varchar(64),
	`locked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_jobs_idempotency_key` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_plan_id_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `units` ADD CONSTRAINT `units_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_units` ADD CONSTRAINT `user_units_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_units` ADD CONSTRAINT `user_units_unit_id_units_id_fk` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_units` ADD CONSTRAINT `user_units_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `permissions` ADD CONSTRAINT `permissions_feature_key_features_key_fk` FOREIGN KEY (`feature_key`) REFERENCES `features`(`key`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_key_permissions_key_fk` FOREIGN KEY (`permission_key`) REFERENCES `permissions`(`key`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `roles` ADD CONSTRAINT `roles_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `feature_dependencies` ADD CONSTRAINT `feature_dependencies_feature_key_features_key_fk` FOREIGN KEY (`feature_key`) REFERENCES `features`(`key`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `feature_dependencies` ADD CONSTRAINT `feature_dependencies_depends_on_key_features_key_fk` FOREIGN KEY (`depends_on_key`) REFERENCES `features`(`key`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `plan_entitlements` ADD CONSTRAINT `plan_entitlements_plan_id_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `plan_entitlements` ADD CONSTRAINT `plan_entitlements_feature_key_features_key_fk` FOREIGN KEY (`feature_key`) REFERENCES `features`(`key`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `tenant_features` ADD CONSTRAINT `tenant_features_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `tenant_features` ADD CONSTRAINT `tenant_features_feature_key_features_key_fk` FOREIGN KEY (`feature_key`) REFERENCES `features`(`key`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `domain_events` ADD CONSTRAINT `domain_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_tenants_status` ON `tenants` (`status`);--> statement-breakpoint
CREATE INDEX `ix_units_tenant_status` ON `units` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_user_units_tenant` ON `user_units` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `ix_user_units_unit` ON `user_units` (`unit_id`);--> statement-breakpoint
CREATE INDEX `ix_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `ix_users_tenant_status` ON `users` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `ix_permissions_feature` ON `permissions` (`feature_key`);--> statement-breakpoint
CREATE INDEX `ix_role_permissions_permission` ON `role_permissions` (`permission_key`);--> statement-breakpoint
CREATE INDEX `ix_user_roles_tenant` ON `user_roles` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `ix_user_roles_role` ON `user_roles` (`role_id`);--> statement-breakpoint
CREATE INDEX `ix_feature_dependencies_depends_on` ON `feature_dependencies` (`depends_on_key`);--> statement-breakpoint
CREATE INDEX `ix_features_type` ON `features` (`type`);--> statement-breakpoint
CREATE INDEX `ix_plan_entitlements_feature` ON `plan_entitlements` (`feature_key`);--> statement-breakpoint
CREATE INDEX `ix_tenant_features_feature` ON `tenant_features` (`feature_key`);--> statement-breakpoint
CREATE INDEX `ix_audit_tenant_created` ON `audit_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_audit_entity` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `ix_audit_action` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `ix_audit_correlation` ON `audit_logs` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `ix_domain_events_tenant_occurred` ON `domain_events` (`tenant_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ix_domain_events_type` ON `domain_events` (`type`);--> statement-breakpoint
CREATE INDEX `ix_domain_events_unpublished` ON `domain_events` (`published_at`);--> statement-breakpoint
CREATE INDEX `ix_jobs_status_run_after` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `ix_jobs_name` ON `jobs` (`name`);--> statement-breakpoint
CREATE INDEX `ix_jobs_tenant` ON `jobs` (`tenant_id`);