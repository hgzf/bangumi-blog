# Security Policy

## Data model

苞谷米日志 is a local-first application. By default, logs, collection data,
images, settings, and generated reports stay in the application data directory
on the user's device.

The following data can leave the device when the corresponding feature is used:

- Bangumi API requests send the configured username or access token to
  `api.bgm.tv`.
- AI chat and generated commentary send the required prompt content to the AI
  endpoint configured by the user.
- Opening the optional in-app AI webpage connects to the webpage selected by
  the user.

API keys and Bangumi tokens are not included in exported backup files.

## Reporting a vulnerability

Please do not publish credentials, personal logs, database files, or API keys in
a public issue.

For a public GitHub repository, use GitHub's private vulnerability reporting
feature when it is enabled. Otherwise, contact the repository owner privately
through their GitHub profile.

Include:

- affected version or commit;
- operating system;
- reproduction steps using synthetic data;
- impact assessment;
- any suggested mitigation.

## Before publishing builds

- Run the unit tests.
- Confirm that no `.env`, API key, access token, signing key, local database, or
  personal screenshot is staged.
- Build release artifacts with a dedicated signing key.
- Never commit `keystore.properties`, `.jks`, `.keystore`, or generated release
  packages.
