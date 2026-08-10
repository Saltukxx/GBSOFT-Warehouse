-- Bir elleçleme biriminin içindeki SKU adedi.
--
-- Koli satırında 1'dir ve mevcut davranış değişmez; palet birim yükünde
-- üzerindeki koli sayısıdır ve brüt ağırlık buradan hesaplanır. Bu alan
-- olmadan sevkiyat satırı "27 palet, her biri 640 kg" diyemiyordu.
ALTER TABLE "ShipmentLine"
ADD COLUMN "unitsPerHandlingUnit" INTEGER NOT NULL DEFAULT 1;
