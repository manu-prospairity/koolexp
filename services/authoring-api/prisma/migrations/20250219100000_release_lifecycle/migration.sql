-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('QUEUED', 'SUBMITTED', 'FAILED');

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'QUEUED',
    "publicationId" TEXT,
    "lastSubmittedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleasePage" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "seo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleasePage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReleasePage_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReleasePage_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReleasePage_releaseId_sortOrder_key" ON "ReleasePage"("releaseId", "sortOrder");
