-- AlterTable
ALTER TABLE "transcoded_chapters" ADD COLUMN "progress" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "transcoded_chapters" ADD COLUMN "errorMessage" TEXT;
ALTER TABLE "transcoded_chapters" ADD COLUMN "storageCommitted" BOOLEAN NOT NULL DEFAULT false;

-- Allow empty playlist/segments while pending
ALTER TABLE "transcoded_chapters" ALTER COLUMN "playlistUrl" SET DEFAULT '';
ALTER TABLE "transcoded_chapters" ALTER COLUMN "segmentsPath" SET DEFAULT '';
ALTER TABLE "transcoded_chapters" ALTER COLUMN "storageProvider" SET DEFAULT 'local';
