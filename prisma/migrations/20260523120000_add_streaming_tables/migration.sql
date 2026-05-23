-- CreateTable
CREATE TABLE "streaming_sessions" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "userId" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "duration" INTEGER,

    CONSTRAINT "streaming_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcoded_chapters" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "bitrate" INTEGER NOT NULL,
    "playlistUrl" TEXT NOT NULL,
    "segmentsPath" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcoded_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcoding_jobs" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcoding_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transcoded_chapters_chapterId_bitrate_key" ON "transcoded_chapters"("chapterId", "bitrate");
