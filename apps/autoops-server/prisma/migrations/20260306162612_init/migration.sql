-- CreateTable
CREATE TABLE `ScheduledTask` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('NOTIFY', 'SMS', 'HTTPS_ISSUE', 'CERT_ISSUE', 'CERT_RENEW', 'HEALTH_CHECK', 'EMAIL_SEND') NOT NULL,
    `payload` JSON NOT NULL,
    `cronExpression` VARCHAR(191) NULL,
    `runAt` DATETIME(3) NULL,
    `status` ENUM('READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'READY',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `backoffMs` INTEGER NOT NULL DEFAULT 5000,
    `lastRunAt` DATETIME(3) NULL,
    `nextRunAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `lastResult` JSON NULL,
    `queueJobId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `certificateId` VARCHAR(191) NULL,

    INDEX `ScheduledTask_status_nextRunAt_idx`(`status`, `nextRunAt`),
    INDEX `ScheduledTask_type_status_idx`(`type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskExecution` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `status` ENUM('READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL,
    `attempt` INTEGER NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,
    `durationMs` INTEGER NULL,
    `result` JSON NULL,
    `error` TEXT NULL,
    `queueJobId` VARCHAR(191) NULL,
    `workerName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TaskExecution_taskId_createdAt_idx`(`taskId`, `createdAt`),
    INDEX `TaskExecution_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Provider` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `category` ENUM('DNS', 'CDN', 'SMTP', 'CLOUD') NOT NULL,
    `credentials` JSON NOT NULL,
    `config` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Provider_type_isActive_idx`(`type`, `isActive`),
    INDEX `Provider_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Certificate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `wildcard` BOOLEAN NOT NULL DEFAULT false,
    `sanDomains` JSON NULL,
    `dnsProviderId` VARCHAR(191) NOT NULL,
    `deployTarget` VARCHAR(191) NULL,
    `deployProviderId` VARCHAR(191) NULL,
    `deployConfig` JSON NULL,
    `certPem` LONGTEXT NULL,
    `keyPem` LONGTEXT NULL,
    `chainPem` LONGTEXT NULL,
    `status` ENUM('PENDING', 'ISSUING', 'ACTIVE', 'EXPIRED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `expiresAt` DATETIME(3) NULL,
    `issuedAt` DATETIME(3) NULL,
    `autoRenew` BOOLEAN NOT NULL DEFAULT true,
    `renewDays` INTEGER NOT NULL DEFAULT 30,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Certificate_domain_status_idx`(`domain`, `status`),
    INDEX `Certificate_expiresAt_idx`(`expiresAt`),
    INDEX `Certificate_dnsProviderId_idx`(`dnsProviderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CertLog` (
    `id` VARCHAR(191) NOT NULL,
    `certificateId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `message` TEXT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CertLog_certificateId_createdAt_idx`(`certificateId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HealthCheck` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL DEFAULT 'GET',
    `headers` JSON NULL,
    `body` VARCHAR(191) NULL,
    `interval` INTEGER NOT NULL DEFAULT 300,
    `timeout` INTEGER NOT NULL DEFAULT 10,
    `retry` INTEGER NOT NULL DEFAULT 3,
    `expectStatus` INTEGER NOT NULL DEFAULT 200,
    `expectBody` VARCHAR(191) NULL,
    `notifyEmail` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastCheckAt` DATETIME(3) NULL,
    `lastStatus` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `HealthCheck_isActive_lastCheckAt_idx`(`isActive`, `lastCheckAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HealthCheckLog` (
    `id` VARCHAR(191) NOT NULL,
    `healthCheckId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `responseTime` INTEGER NULL,
    `statusCode` INTEGER NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `HealthCheckLog_healthCheckId_createdAt_idx`(`healthCheckId`, `createdAt`),
    INDEX `HealthCheckLog_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailConfig` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `host` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL,
    `secure` BOOLEAN NOT NULL DEFAULT true,
    `auth` JSON NOT NULL,
    `from` VARCHAR(191) NOT NULL,
    `fromName` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EmailConfig_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
