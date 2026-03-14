-- AlterTable
ALTER TABLE `DeploymentProject`
  ADD COLUMN `certificateId` VARCHAR(191) NULL,
  ADD COLUMN `enableTlsAutoBind` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `nginxServerName` VARCHAR(191) NULL,
  ADD COLUMN `nginxConfigPath` VARCHAR(191) NULL,
  ADD COLUMN `nginxCertPath` VARCHAR(191) NULL,
  ADD COLUMN `nginxKeyPath` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `DeploymentProject_certificateId_idx` ON `DeploymentProject`(`certificateId`);

-- AddForeignKey
ALTER TABLE `DeploymentProject`
  ADD CONSTRAINT `DeploymentProject_certificateId_fkey`
  FOREIGN KEY (`certificateId`) REFERENCES `Certificate`(`id`)
  ON DELETE SET NULL
  ON UPDATE CASCADE;
