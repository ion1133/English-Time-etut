# BEFORE UPLOADING THIS ZIP TO GITHUB

**This is a candidate source package, NOT a production-authorized release.** The owner requested a final working upgrade, but missing access to a real disposable PostgreSQL instance and production-backup clone means the testing/backup gate could not be met in this environment. Deploying to the EXISTING Kızılay app or database now could put real student records at risk. No live service or database has been touched.

Owner's supplied choices are recorded in `PRODUCT_DECISIONS.md`. Read it, then `TEST_REPORT_NEW.md` for exactly executed versus blocked checks, `MIGRATION_AND_DATA_PRESERVATION_REPORT.md` for the obligatory cloned-data rehearsal, and `OWNER_DEPLOYMENT_INSTRUCTIONS.md` for dashboard-only branch-by-branch launch after all gates pass.

DO NOT treat the existing historical `TEST_REPORT.md` or `DEPLOY_CHECKLIST.md` in this ZIP as evidence that this modified version has passed modern PostgreSQL/new-feature tests. The new dated report/checklist supersedes them for this upgrade.
