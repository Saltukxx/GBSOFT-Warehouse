-- Faz 7.3: Palet editöründe sabitlenen yerleşimler yeniden çözmede korunur.
ALTER TABLE "PalletPlacement"
ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;
