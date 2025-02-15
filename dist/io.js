import core from "@actions/core";
import process from "node:process";
import path from "node:path";
import os from "node:os";
function getTarget() {
    const target = getInput("target", true).toLowerCase();
    if (target != 'firebase' && target != 'github') {
        core.error("target must be either 'github' or 'firebase'");
        process.exit(1);
    }
    return target;
}
function getInput(name, required = false) {
    return core.getInput(name, { required });
}
function getBooleanInput(name, required = false) {
    return core.getBooleanInput(name, { required });
}
function getInputOrUndefined(name) {
    const data = core.getInput(name);
    if (data === '') {
        return undefined;
    }
    else {
        return data;
    }
}
const inputs = {
    target: getTarget(),
    language: getInput('language'),
    report_name: getInputOrUndefined('report_name'),
    custom_report_dir: core.getInput('report_dir') || getInputOrUndefined('custom_report_dir'),
    allure_results_path: getInput('allure_results_path', true),
    retries: getInput('retries'),
    show_history: getBooleanInput('show_history'),
    github_token: getInput('github_token'),
    github_pages_branch: getInputOrUndefined('github_pages_branch'),
    github_pages_repo: getInput('github_pages_repo'),
    gcs_bucket: getInputOrUndefined('gcs_bucket'),
    gcs_bucket_prefix: getInputOrUndefined('gcs_bucket_prefix') ? replaceWhiteSpace(getInput('gcs_bucket_prefix')) : undefined,
    google_credentials_json: getInputOrUndefined('google_credentials_json'),
    pr_comment: getBooleanInput('pr_comment'),
    slack_channel: getInput('slack_channel'),
    slack_token: getInput('slack_token'),
    keep: getInput('keep'),
    prefix: prefix(),
    runtimeCredentialDir: path.posix.join(runtimeDir(), "credentials/key.json"),
    fileProcessingConcurrency: 10,
    RESULTS_STAGING_PATH: path.posix.join(runtimeDir(), "allure-results"),
    ARCHIVE_DIR: path.posix.join(runtimeDir(), "archive"),
    GIT_WORKSPACE: workspace(),
    REPORTS_DIR: path.posix.join(workspace(), prefix()),
};
function replaceWhiteSpace(s, replaceValue = '-') {
    return s.replace(/\s+/g, replaceValue);
}
function prefix() {
    let prefix;
    switch (getTarget()) {
        case 'github':
            {
                prefix = core.getInput('gh_artifact_prefix');
            }
            break;
        case "firebase": {
            prefix = core.getInput('gcs_bucket_prefix');
        }
    }
    if (!prefix) {
        prefix = getInput('prefix');
    }
    return replaceWhiteSpace(prefix);
}
function workspace() {
    return path.posix.join(runtimeDir(), 'report');
}
function runtimeDir() {
    return path.posix.join(os.tmpdir(), 'allure-report-deployer');
}
export default inputs;
