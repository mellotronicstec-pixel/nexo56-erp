CREATE TABLE `service_order_tasks` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`service_order_id` varchar(36) NOT NULL,
	`kind` varchar(40) NOT NULL,
	`title` varchar(160) NOT NULL,
	`description` varchar(500),
	`assignee_id` varchar(36),
	`due_date` varchar(10),
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`open_marker` tinyint,
	`created_by` varchar(36),
	`completed_at` datetime(3),
	`completed_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `service_order_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_so_task_open` UNIQUE(`service_order_id`,`kind`,`open_marker`)
);
--> statement-breakpoint
ALTER TABLE `service_order_timeline` ADD `reason` varchar(300);--> statement-breakpoint
ALTER TABLE `service_orders` ADD `status_changed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `service_orders` ADD `version` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `service_orders` ADD `assigned_technician_id` varchar(36);--> statement-breakpoint
ALTER TABLE `service_orders` ADD `follow_up_at` varchar(10);--> statement-breakpoint
ALTER TABLE `service_orders` ADD `follow_up_alerted_for` varchar(10);--> statement-breakpoint
ALTER TABLE `service_order_tasks` ADD CONSTRAINT `fk_so_task_order_tenant` FOREIGN KEY (`service_order_id`,`tenant_id`) REFERENCES `service_orders`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `service_order_tasks` ADD CONSTRAINT `fk_so_task_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `service_order_tasks` ADD CONSTRAINT `fk_so_task_assignee_tenant` FOREIGN KEY (`assignee_id`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_so_task_order` ON `service_order_tasks` (`service_order_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_so_task_unit_due` ON `service_order_tasks` (`tenant_id`,`unit_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `ix_so_task_assignee` ON `service_order_tasks` (`tenant_id`,`assignee_id`,`status`);--> statement-breakpoint
ALTER TABLE `service_orders` ADD CONSTRAINT `fk_service_order_technician_tenant` FOREIGN KEY (`assigned_technician_id`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_service_order_unit_status` ON `service_orders` (`tenant_id`,`unit_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_service_order_follow_up` ON `service_orders` (`tenant_id`,`follow_up_at`);--> statement-breakpoint
CREATE INDEX `ix_service_order_technician` ON `service_orders` (`tenant_id`,`assigned_technician_id`);