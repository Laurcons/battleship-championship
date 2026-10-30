-- AlterTable
ALTER TABLE `Participant` ADD COLUMN `activityReviewedAt` BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `ProgramConnection` (
    `id` VARCHAR(64) NOT NULL,
    `participantId` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `at` BIGINT NOT NULL,
    `endedAt` BIGINT NULL,
    `endReason` VARCHAR(200) NULL,
    `ip` VARCHAR(64) NOT NULL,
    `secure` BOOLEAN NOT NULL,
    `programName` VARCHAR(100) NULL,
    `programVersion` VARCHAR(100) NULL,
    `lobbyId` VARCHAR(40) NOT NULL,
    `seat` INTEGER NULL,
    `takeoverIp` VARCHAR(64) NULL,

    INDEX `ProgramConnection_participantId_at_idx`(`participantId`, `at`),
    INDEX `ProgramConnection_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProgramConnection` ADD CONSTRAINT `ProgramConnection_participantId_fkey` FOREIGN KEY (`participantId`) REFERENCES `Participant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
