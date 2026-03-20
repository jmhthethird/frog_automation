'use strict';

/**
 * Top-level Google Drive folder categories.
 *
 * When uploading files to Google Drive the application creates a category
 * folder between the user-selected root folder and the per-domain subfolder.
 * This keeps artefacts from different features cleanly separated:
 *
 *   [Root Folder]
 *     ├── Crawls/          ← DRIVE_CATEGORIES.CRAWLS
 *     │     └── <domain>/
 *     ├── Reports/         ← DRIVE_CATEGORIES.REPORTS
 *     │     └── <domain>/
 *     ├── Automation/      ← DRIVE_CATEGORIES.AUTOMATION
 *     │     └── <domain>/
 *     └── Templates/       ← DRIVE_CATEGORIES.TEMPLATES  (no domain subfolder)
 *
 * Each entry is a frozen object with two properties:
 *
 *   folder              – The folder name created on Google Drive.
 *   useDomainSubfolder  – When true, a <domain> subfolder is created inside
 *                         the category folder and files are placed there.
 *                         When false, files are placed directly inside the
 *                         category folder.
 *
 * Pass one of these values as the `driveCategory` option to `uploadToDrive()`
 * so that uploaded artefacts land in the correct branch of the tree.
 *
 * To add a new top-level category, define a new key here and reference it in
 * the calling code — no changes to the upload logic itself are required.
 */
const DRIVE_CATEGORIES = Object.freeze({
  CRAWLS:     Object.freeze({ folder: 'Crawls',     useDomainSubfolder: true }),
  REPORTS:    Object.freeze({ folder: 'Reports',    useDomainSubfolder: true }),
  AUTOMATION: Object.freeze({ folder: 'Automation', useDomainSubfolder: true }),
  TEMPLATES:  Object.freeze({ folder: 'Templates',  useDomainSubfolder: false }),
});

module.exports = { DRIVE_CATEGORIES };
