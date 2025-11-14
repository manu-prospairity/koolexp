-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalEntityType" AS ENUM ('PAGE', 'FRAGMENT');

-- CreateTable
CREATE TABLE "PageSchedule" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageWorkflowEvent" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageWorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FragmentWorkflowEvent" (
    "id" TEXT NOT NULL,
    "fragmentId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FragmentWorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "entityType" "ApprovalEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageSchedule_pageId_key" ON "PageSchedule"("pageId");

-- CreateIndex
CREATE INDEX "PageWorkflowEvent_pageId_createdAt_idx" ON "PageWorkflowEvent"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "FragmentWorkflowEvent_fragmentId_createdAt_idx" ON "FragmentWorkflowEvent"("fragmentId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_entityType_entityId_idx" ON "ApprovalRequest"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "PageSchedule" ADD CONSTRAINT "PageSchedule_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageWorkflowEvent" ADD CONSTRAINT "PageWorkflowEvent_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FragmentWorkflowEvent" ADD CONSTRAINT "FragmentWorkflowEvent_fragmentId_fkey" FOREIGN KEY ("fragmentId") REFERENCES "ContentFragment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
