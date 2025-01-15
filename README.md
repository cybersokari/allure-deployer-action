# Allure Deployer Action
**Host your Allure Reports on the web with history, retries, and Slack notifications.
No server required.**
</br>
</br>
Supports deployment to **Firebase Hosting** and **GitHub Pages**.
</br>
</br> Example report: https://gatedaccessdev.web.app
</br> See [complete documentation](https://github.com/cybersokari/allure-report-deployer) for more info.


## 📋 Examples

**Deploy report to GitHub Pages**
```yaml
jobs:
  gh-pages:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test
        run: #Run test and create allure results
      - name: Deploy Reports to GitHub pages with History and Retries
        uses: cybersokari/allure-deployer-action@v1.4.2
        with:
          target: 'github'
          github_token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
          github_pages_branch: 'gh-pages'
          allure_results_path: 'allure-results'
          google_credentials_json: ${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }} # Required for History and Retries
          storage_bucket: ${{vars.STORAGE_BUCKET}}
          show_history: 'true'
          retries: 5
```
**Deploy report to Firebase Hosting**
```yaml
jobs:
  firebase:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test
        run: #Run test and create allure results
      - name: Deploy Reports to Firebase with History and Retries
        uses: cybersokari/allure-deployer-action@v1.4.2
        with:
          target: 'firebase'
          allure_results_path: 'allure-results'
          google_credentials_json: ${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }}
          storage_bucket: ${{vars.STORAGE_BUCKET}}
          show_history: 'true'
          retries: 5
```

**Deploy report to Firebase Hosting on Pull request**
```yaml
on:
  pull_request:
jobs:
  firebase:
    runs-on: ubuntu-latest
    permissions: 
      pull-requests: write # For when `pr_comment` is `true`
      issues: write # For when `pr_comment` is `true`
    steps:
      - uses: actions/checkout@v4.1.5
      - name: Run test
        run: #Run test and create allure results
      - name: Deploy Reports to Firebase with History and Retries
        uses: cybersokari/allure-deployer-action@v1.4.2
        with:
          target: 'firebase'
          allure_results_path: 'allure-results'
          google_credentials_json: ${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }}
          storage_bucket: ${{vars.STORAGE_BUCKET}}
          show_history: 'true'
          retries: 5
          pr_comment: 'true'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## 🚀 Features
- **Serverless hosting**: Host your reports on the [web](https://firebase.google.com/docs/hosting), not storage.
- **History & Retries**: Show history and retries in reports with history linking to previous reports.
- **Cloud Backup**: Save test results in storage for future analysis.
- **Slack Notifications**: Notify stakeholders with report URL and details.
- **Pull Request Comment**: Post test report URL and status as comment on pull request for your team. See [example.](https://github.com/cybersokari/allure-report-deployer/pull/6#issuecomment-2564403881)


## 🛠️ Inputs
| Input                     | Description                                                                                                      | Required | Default          |
|---------------------------|------------------------------------------------------------------------------------------------------------------|----------|------------------|
| `google_credentials_json` | Firebase (Google Cloud) credentials JSON                                                                         | Yes      | None             |
| `allure_results_path`     | Path to the directory containing Allure results files.                                                           | Yes      | `allure-results` |
| `report_name`             | The name/title of your report.                                                                                   | No       | `Allure Report`  |
| `target`                  | Set where to deploy test Report. `firebase` or `github`. `github` requires `github_token`                        | No       | `firebase`       |
| `storage_bucket`          | Name of the Google Cloud Storage bucket for backup and history storage.                                          | No       | None             |
| `prefix`                  | Path prefix in the Cloud Storage bucket for archiving files.                                                     | No       | None             |
| `show_history`            | Display history from previous test runs.                                                                         | No       | `true`           |
| `retries`                 | Number of previous test runs to show as retries in the upcoming report when Storage `storage_bucket` is provided | No       | 0                |
| `output`                  | A directory to generate Allure report into. Setting this value disables report hosting and Slack notification    | No       | None             |
| `slack_channel`           | ID of the Slack channel to send notifications about report links.                                                | No       | None             |
| `slack_token`             | Token for Slack App to send notifications with report URLs.                                                      | No       | None             |
| `github_token`            | A generated GITHUB_TOKEN for when `github_pages_branch` is provide or when `pr_comment` is set to `true`         | No       | None             |
| `pr_comment`              | Post test report information as pull request comment. Requires `github_token` to be set with permission          | No       | `false`          |
| `github_pages_branch`     | Set target branch for Deploying test report to GitHub Pages. Requires `github_token` to be set with permission   | No       | None             |


## 📤 Outputs
| Key          | Description             |
|--------------|-------------------------|
| `report_url` | URL of the test report. |


## 🔧 Environment Setup

- **Firebase Google Credentials**: Export a [service account](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments) JSON file from your Firebase Console.
- **Slack Integration**: Optional. Create a Slack app for notifications and obtain its token.
- **Pull request comment**: Optional. Set the `github_token` input with `pull_request` and `issues` write permission enabled 


## 📜 License
This project is licensed under the [BSD-3 License](LICENSE). See the LICENSE file for details.

## 🤝 Contributing
Contributions are welcome! Open issues or submit [pull requests](https://github.com/cybersokari/allure-report-deployer) to improve this action.
