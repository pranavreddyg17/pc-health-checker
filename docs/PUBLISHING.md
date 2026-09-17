# Publish PC Health with your own Git identity

The repository is prepared for an initial commit. You make the commit and push from your terminal. No assistant co-author trailer is needed; GitHub attributes a commit through its recorded author email.

## 1. Confirm your author

From the project directory:

```sh
git config user.name
git config user.email
```

Your current identity is:

```text
Pranav Reddy Gudipati
56127176+pranavreddyg17@users.noreply.github.com
```

This noreply address keeps your personal email out of commit metadata. If you change it, use an email associated with your GitHub account. See [GitHub's commit-email instructions](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address).

## 2. Review and create your commit

```sh
git add .
git diff --cached --stat
git diff --cached --check
git commit -m "feat: introduce PC Health offline diagnostics and repair workbench" \
  -m "Add cross-platform health collectors, local reliability monitoring, guided repairs, workload investigations, preview packaging, and documentation with a 30-second app demo."
git show -s --format=fuller HEAD
```

The final command lets you check the author and committer before publishing. Review staged content before committing. Generated installers, dependencies, local data and test screenshots are ignored. The small MP4 and poster under `docs/media/` are intentional repository assets.

## 3. Create your repository and push

Create an empty repository in your GitHub account. Leave its README, license and `.gitignore` initialization options unchecked because these files already exist locally. Then substitute your actual repository URL:

```sh
git remote add origin https://github.com/pranavreddyg17/YOUR-REPOSITORY.git
git push -u origin main
```

No remote is configured in the prepared local repository. If you already added one, inspect `git remote -v` instead of adding a duplicate.

Suggested repository description:

> Offline hardware diagnostics, guided troubleshooting, and local reliability monitoring for macOS, Windows, and Linux.

Suggested topics: `hardware-diagnostics`, `system-monitoring`, `electron`, `react`, `typescript`, `offline`, `smartctl`.

## 4. Share the app

Create a GitHub release after pushing, mark it as a **pre-release**, and upload the DMG, Windows installer, ZIP alternatives and `SHA256SUMS.txt` from `release/0.7.0/`. Use [SHARING.md](../SHARING.md) for installation instructions and signing/qualification limitations. Do not commit the large installer files.

The README's poster links to the committed 30-second MP4. For an inline player in a release or repository discussion, upload that MP4 through GitHub's editor and use the attachment link GitHub generates.

The application source is currently `UNLICENSED`. Publishing it does not grant an open-source license. Choose a license deliberately if you want to allow others to reuse the application; preserve bundled third-party notices in all cases.
