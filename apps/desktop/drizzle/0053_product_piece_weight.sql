CREATE TABLE `product_piece_weights` (
	`product_id` text PRIMARY KEY NOT NULL,
	`kg_per_unit` real NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
