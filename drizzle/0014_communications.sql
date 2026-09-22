CREATE TABLE `communication_attachments` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`message_id` varchar(36) NOT NULL,
	`kind` varchar(30) NOT NULL,
	`warranty_id` varchar(36),
	`filename` varchar(200) NOT NULL,
	`mime_type` varchar(60) NOT NULL,
	`byte_size` int unsigned NOT NULL,
	`checksum` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `communication_attachments_id` PRIMARY KEY(`id`),
	CONSTRAINT `ck_comm_attachment_kind` CHECK(kind IN ('warranty_certificate')),
	CONSTRAINT `ck_comm_attachment_warranty` CHECK(kind <> 'warranty_certificate' OR warranty_id IS NOT NULL),
	CONSTRAINT `ck_comm_attachment_size` CHECK(byte_size > 0)
);
--> statement-breakpoint
CREATE TABLE `communication_attempts` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`message_id` varchar(36) NOT NULL,
	`attempt_number` int unsigned NOT NULL,
	`provider` varchar(40) NOT NULL,
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	`duration_ms` int unsigned,
	`outcome` varchar(20) NOT NULL,
	`error_code` varchar(30),
	`error_detail` varchar(500),
	`provider_message_id` varchar(190),
	`correlation_id` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `communication_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_comm_attempt_number` UNIQUE(`message_id`,`attempt_number`),
	CONSTRAINT `ck_comm_attempt_outcome` CHECK(outcome IN ('accepted','failed')),
	CONSTRAINT `ck_comm_attempt_error` CHECK((outcome = 'failed' AND error_code IS NOT NULL) OR (outcome = 'accepted' AND error_code IS NULL))
);
--> statement-breakpoint
CREATE TABLE `communication_messages` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`channel` varchar(20) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'queued',
	`origin` varchar(20) NOT NULL,
	`purpose` varchar(30) NOT NULL DEFAULT 'generic',
	`recipient_value` varchar(190) NOT NULL,
	`recipient_display` varchar(190) NOT NULL,
	`customer_id` varchar(36),
	`subject` varchar(200),
	`body` text NOT NULL,
	`template_id` varchar(36),
	`service_order_id` varchar(36),
	`attempt_count` int unsigned NOT NULL DEFAULT 0,
	`last_attempt_at` datetime(3),
	`last_error_code` varchar(30),
	`last_error_detail` varchar(500),
	`sent_at` datetime(3),
	`sent_provider` varchar(40),
	`provider_message_id` varchar(190),
	`cancelled_at` datetime(3),
	`cancelled_by` varchar(36),
	`cancel_reason` varchar(300),
	`requested_by` varchar(36),
	`source_event_id` varchar(36),
	`idempotency_key` varchar(190),
	`correlation_id` varchar(36),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `communication_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_comm_message_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `uq_comm_message_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `ck_comm_message_channel` CHECK(channel IN ('whatsapp','email','sms')),
	CONSTRAINT `ck_comm_message_status` CHECK(status IN ('queued','sending','sent','failed','cancelled')),
	CONSTRAINT `ck_comm_message_origin` CHECK(origin IN ('manual','domain_event')),
	CONSTRAINT `ck_comm_message_purpose` CHECK(purpose IN ('generic','service_update','ready_for_pickup','quote_available','warranty_document')),
	CONSTRAINT `ck_comm_message_subject_channel` CHECK((channel = 'email' AND subject IS NOT NULL) OR (channel <> 'email' AND subject IS NULL)),
	CONSTRAINT `ck_comm_message_sent_at` CHECK((status = 'sent' AND sent_at IS NOT NULL) OR (status <> 'sent' AND sent_at IS NULL)),
	CONSTRAINT `ck_comm_message_cancelled_at` CHECK((status = 'cancelled' AND cancelled_at IS NOT NULL) OR (status <> 'cancelled' AND cancelled_at IS NULL))
);
--> statement-breakpoint
CREATE TABLE `communication_templates` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`name_normalized` varchar(120) NOT NULL,
	`channel` varchar(20) NOT NULL,
	`purpose` varchar(30) NOT NULL DEFAULT 'generic',
	`subject` varchar(200),
	`body` text NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`active_marker` tinyint,
	`archived_at` datetime(3),
	`archived_by` varchar(36),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `communication_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_comm_template_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `uq_comm_template_active_name` UNIQUE(`tenant_id`,`name_normalized`,`active_marker`),
	CONSTRAINT `ck_comm_template_channel` CHECK(channel IN ('whatsapp','email','sms')),
	CONSTRAINT `ck_comm_template_status` CHECK(status IN ('active','archived')),
	CONSTRAINT `ck_comm_template_purpose` CHECK(purpose IN ('generic','service_update','ready_for_pickup','quote_available','warranty_document')),
	CONSTRAINT `ck_comm_template_subject_channel` CHECK((channel = 'email' AND subject IS NOT NULL) OR (channel <> 'email' AND subject IS NULL)),
	CONSTRAINT `ck_comm_template_active_marker` CHECK((status = 'active' AND active_marker = 1) OR (status = 'archived' AND active_marker IS NULL))
);
--> statement-breakpoint
ALTER TABLE `communication_attachments` ADD CONSTRAINT `communication_attachments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_attachments` ADD CONSTRAINT `fk_comm_attachment_message_tenant` FOREIGN KEY (`message_id`,`tenant_id`) REFERENCES `communication_messages`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_attachments` ADD CONSTRAINT `fk_comm_attachment_warranty_tenant` FOREIGN KEY (`warranty_id`,`tenant_id`) REFERENCES `warranties`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `communication_attempts` ADD CONSTRAINT `communication_attempts_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_attempts` ADD CONSTRAINT `fk_comm_attempt_message_tenant` FOREIGN KEY (`message_id`,`tenant_id`) REFERENCES `communication_messages`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_messages` ADD CONSTRAINT `communication_messages_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_messages` ADD CONSTRAINT `fk_comm_message_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_messages` ADD CONSTRAINT `fk_comm_message_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_messages` ADD CONSTRAINT `fk_comm_message_template_tenant` FOREIGN KEY (`template_id`,`tenant_id`) REFERENCES `communication_templates`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_messages` ADD CONSTRAINT `fk_comm_message_order_unit` FOREIGN KEY (`service_order_id`,`unit_id`) REFERENCES `service_orders`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_messages` ADD CONSTRAINT `fk_comm_message_requested_by_tenant` FOREIGN KEY (`requested_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_messages` ADD CONSTRAINT `fk_comm_message_cancelled_by_tenant` FOREIGN KEY (`cancelled_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_templates` ADD CONSTRAINT `communication_templates_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `communication_templates` ADD CONSTRAINT `fk_comm_template_created_by_tenant` FOREIGN KEY (`created_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_comm_attachment_message` ON `communication_attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `ix_comm_attempt_message` ON `communication_attempts` (`message_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ix_comm_message_unit_created` ON `communication_messages` (`tenant_id`,`unit_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_comm_message_unit_status` ON `communication_messages` (`tenant_id`,`unit_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_comm_message_pending` ON `communication_messages` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_comm_message_order` ON `communication_messages` (`tenant_id`,`service_order_id`);--> statement-breakpoint
CREATE INDEX `ix_comm_message_customer` ON `communication_messages` (`tenant_id`,`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_comm_template_tenant_channel` ON `communication_templates` (`tenant_id`,`channel`,`status`);