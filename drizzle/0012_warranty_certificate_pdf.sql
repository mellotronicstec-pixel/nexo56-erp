ALTER TABLE `warranty_certificates` ADD `pdf_storage_key` varchar(255);--> statement-breakpoint
ALTER TABLE `warranty_certificates` ADD `pdf_mime_type` varchar(100);--> statement-breakpoint
ALTER TABLE `warranty_certificates` ADD `pdf_byte_size` int unsigned;--> statement-breakpoint
ALTER TABLE `warranty_certificates` ADD `pdf_checksum` varchar(64);--> statement-breakpoint
ALTER TABLE `warranty_certificates` ADD `pdf_snapshot_checksum` varchar(64);--> statement-breakpoint
ALTER TABLE `warranty_certificates` ADD `pdf_page_count` int unsigned;--> statement-breakpoint
ALTER TABLE `warranty_certificates` ADD `pdf_generated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `warranty_certificates` ADD `pdf_renderer` varchar(60);