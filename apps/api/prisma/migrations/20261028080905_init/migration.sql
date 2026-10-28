-- CreateTable
CREATE TABLE `Participant` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `tokenHash` CHAR(64) NULL,
    `tokenPreview` VARCHAR(8) NULL,
    `tokenCreatedAt` BIGINT NULL,
    `tokenReplaced` BOOLEAN NOT NULL DEFAULT false,
    `tokenNoticeAt` BIGINT NULL,
    `createdAt` BIGINT NOT NULL,

    UNIQUE INDEX `Participant_name_key`(`name`),
    UNIQUE INDEX `Participant_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ruleset` (
    `id` VARCHAR(40) NOT NULL,
    `data` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `createdAt` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `key` VARCHAR(64) NOT NULL,
    `value` TEXT NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Lobby` (
    `id` VARCHAR(16) NOT NULL,
    `rulesetId` VARCHAR(40) NOT NULL,
    `godMode` BOOLEAN NOT NULL,
    `createdBy` VARCHAR(64) NOT NULL,
    `seat1` VARCHAR(200) NOT NULL,
    `seat2` VARCHAR(200) NOT NULL,
    `createdAt` BIGINT NOT NULL,
    `lastActivityAt` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Series` (
    `id` VARCHAR(64) NOT NULL,
    `lobbyId` VARCHAR(16) NOT NULL,
    `target` INTEGER NOT NULL,
    `played` INTEGER NOT NULL,
    `score1` INTEGER NOT NULL,
    `score2` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `abortReason` VARCHAR(500) NULL,
    `startedAt` BIGINT NOT NULL,
    `endedAt` BIGINT NULL,
    `heatmap` TEXT NOT NULL,

    INDEX `Series_lobbyId_idx`(`lobbyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Game` (
    `id` VARCHAR(64) NOT NULL,
    `lobbyId` VARCHAR(16) NOT NULL,
    `seriesId` VARCHAR(64) NOT NULL,
    `idx` INTEGER NOT NULL,
    `first` INTEGER NOT NULL,
    `status` VARCHAR(8) NOT NULL,
    `winner` INTEGER NULL,
    `reason` VARCHAR(16) NULL,
    `startedAt` BIGINT NOT NULL,
    `endedAt` BIGINT NOT NULL,
    `shots1` INTEGER NOT NULL,
    `shots2` INTEGER NOT NULL,
    `infractions1` INTEGER NOT NULL,
    `infractions2` INTEGER NOT NULL,
    `events` MEDIUMTEXT NOT NULL,
    `times` MEDIUMTEXT NOT NULL,
    `summary` TEXT NULL,

    INDEX `Game_seriesId_idx_idx`(`seriesId`, `idx`),
    INDEX `Game_lobbyId_idx`(`lobbyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `at` BIGINT NOT NULL,
    `actor` VARCHAR(120) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `target` VARCHAR(200) NULL,
    `detail` VARCHAR(500) NULL,

    INDEX `AuditLog_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebSession` (
    `idHash` CHAR(64) NOT NULL,
    `role` VARCHAR(12) NOT NULL,
    `participantId` VARCHAR(64) NULL,
    `adminUsername` VARCHAR(100) NULL,
    `createdAt` BIGINT NOT NULL,
    `expiresAt` BIGINT NOT NULL,

    INDEX `WebSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`idHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Series` ADD CONSTRAINT `Series_lobbyId_fkey` FOREIGN KEY (`lobbyId`) REFERENCES `Lobby`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Game` ADD CONSTRAINT `Game_lobbyId_fkey` FOREIGN KEY (`lobbyId`) REFERENCES `Lobby`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Game` ADD CONSTRAINT `Game_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
