-- Oferta → corte suelto. Null = el producto es su propia mercadería.
-- El destino tiene que seguir con base_product_id null (sin cadenas).
-- Se matchea por plu_number: la base real ya tiene los productos y el seed no pisa fichas.
-- No se enlazan 313 (Falda puchero x2kg), 343 (Milanesas x3kg) ni 406 (Bola/cuadrada pieza).
ALTER TABLE `products` ADD `base_product_id` text REFERENCES `products`(`id`);
--> statement-breakpoint
WITH links(offer_plu, base_plu) AS (
  VALUES
    (301, 1),
    (302, 2),
    (303, 4),
    (401, 4),
    (407, 5),
    (408, 5),
    (312, 6),
    (307, 7),
    (402, 7),
    (306, 8),
    (403, 8),
    (304, 11),
    (305, 12),
    (308, 14),
    (404, 21),
    (405, 22),
    (409, 20),
    (309, 31),
    (314, 29),
    (315, 27),
    (342, 154),
    (341, 154),
    (320, 150),
    (410, 150),
    (321, 151),
    (411, 151),
    (310, 152),
    (330, 102),
    (331, 102),
    (332, 103),
    (333, 103),
    (335, 105),
    (336, 106),
    (311, 104),
    (340, 257)
)
UPDATE `products`
SET `base_product_id` = (
  SELECT base.`id`
  FROM links
  INNER JOIN `products` AS base ON base.`plu_number` = links.base_plu
  WHERE links.offer_plu = `products`.`plu_number`
    AND base.`base_product_id` IS NULL
)
WHERE `products`.`base_product_id` IS NULL
  AND EXISTS (
    SELECT 1
    FROM links
    INNER JOIN `products` AS base ON base.`plu_number` = links.base_plu
    WHERE links.offer_plu = `products`.`plu_number`
      AND base.`base_product_id` IS NULL
  );
