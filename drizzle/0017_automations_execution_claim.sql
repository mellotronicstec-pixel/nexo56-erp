ALTER TABLE `automation_executions` ADD `locked_by` varchar(64);--> statement-breakpoint
ALTER TABLE `automation_executions` ADD `locked_at` datetime(3);