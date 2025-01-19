import * as process from "node:process";
import path from "node:path";
import { Allure, ConsoleNotifier, GoogleStorageService, getDashboardUrl, NotificationData, SlackService, SlackNotifier, Storage, getReportStats, NotifyHandler, FirebaseHost, FirebaseService, validateResultsPaths, getRuntimeDirectory, copyFiles, } from "allure-deployer-shared";
import { Storage as GCPStorage } from "@google-cloud/storage";
import { GitHubService } from "./services/github.service.js";
import { GitHubNotifier } from "./features/messaging/github-notifier.js";
import { GithubPagesService } from "./services/github-pages.service.js";
import { GithubHost } from "./features/hosting/github.host.js";
import github from "@actions/github";
import core from "@actions/core";
import { setGoogleCredentialsEnv, validateSlackConfig } from "./utilities/util.js";
function getGoogleCredentials() {
    const credentials = core.getInput("google_credentials_json");
    if (!credentials) {
        console.log("No Google Credentials found.");
        return undefined;
    }
    return credentials;
}
export function main() {
    (async () => {
        const token = core.getInput("github_token");
        const target = core.getInput("target");
        const resultsPaths = core.getInput("allure_results_path", { required: true });
        const showHistory = core.getBooleanInput("show_history");
        const retries = parseInt(core.getInput("retries") || "0", 10);
        const runtimeDir = await getRuntimeDirectory();
        const reportOutputPath = core.getInput("output");
        const REPORTS_DIR = reportOutputPath !== '' ? reportOutputPath : path.join(runtimeDir, "allure-report");
        const ghBranch = core.getInput("github_pages_branch");
        const googleCreds = getGoogleCredentials();
        let firebaseProjectId;
        if (googleCreds) {
            firebaseProjectId = await setGoogleCredentialsEnv(googleCreds);
        }
        if (!firebaseProjectId && !token) {
            core.setFailed("Error: You must set either 'google_credentials_json' or 'github_token'.");
        }
        if (!["firebase", "github"].includes(target)) {
            core.setFailed("Error: target must be either 'github' or 'firebase'.");
        }
        if (target === "github" && !token) {
            core.setFailed("Github Pages require a 'github_token'.");
        }
        if (target === "firebase" && !googleCreds) {
            core.setFailed("Firebase Hosting require a 'google_credentials_json'.");
        }
        const host = initializeHost({
            target,
            token,
            ghBranch,
            firebaseProjectId,
            REPORTS_DIR,
        });
        const storageBucket = core.getInput("storage_bucket");
        const inputs = {
            googleCredentialData: googleCreds,
            storageBucket: storageBucket !== '' ? storageBucket : undefined,
            runtimeCredentialDir: path.join(runtimeDir, "credentials/key.json"),
            fileProcessingConcurrency: 10,
            RESULTS_PATHS: await validateResultsPaths(resultsPaths),
            RESULTS_STAGING_PATH: path.join(runtimeDir, "allure-results"),
            ARCHIVE_DIR: path.join(runtimeDir, "archive"),
            REPORTS_DIR,
            reportName: core.getInput("report_name"),
            retries,
            showHistory,
            prefix: core.getInput("prefix"),
            uploadRequired: showHistory || retries > 0,
            downloadRequired: showHistory || retries > 0,
            firebaseProjectId,
            host,
        };
        await executeDeployment(inputs);
    })();
}
async function executeDeployment(args) {
    try {
        const storage = args.storageBucket && args.googleCredentialData
            ? await initializeStorage(args)
            : undefined;
        const [reportUrl] = await stageDeployment(args, storage);
        const allure = new Allure({ args });
        await generateAllureReport({ allure, reportUrl });
        const [resultsStats] = await finalizeDeployment({ args, storage });
        await sendNotifications(args, resultsStats, reportUrl);
    }
    catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
    }
}
function initializeHost({ target, token, ghBranch, firebaseProjectId, REPORTS_DIR, }) {
    if (token && ghBranch && target === "github") {
        const client = new GithubPagesService({ token, branch: ghBranch, filesDir: REPORTS_DIR });
        return new GithubHost(client, ghBranch);
    }
    else if (target === "firebase" && firebaseProjectId) {
        return new FirebaseHost(new FirebaseService(firebaseProjectId, REPORTS_DIR));
    }
    return undefined;
}
async function initializeStorage(args) {
    const { storageBucket, googleCredentialData } = args;
    if (!googleCredentialData || !storageBucket)
        return undefined;
    try {
        const credentials = JSON.parse(googleCredentialData);
        const bucket = new GCPStorage({ credentials }).bucket(storageBucket);
        const [exists] = await bucket.exists();
        if (!exists) {
            console.log(`GCP storage bucket '${bucket.name}' does not exist. History and Retries will be disabled.`);
            return undefined;
        }
        return new Storage(new GoogleStorageService(bucket, core.getInput("prefix")), args);
    }
    catch (error) {
        handleStorageError(error);
        throw error;
    }
}
async function stageDeployment(args, storage) {
    console.log("Staging files...");
    const copyResultsFiles = copyFiles({
        from: args.RESULTS_PATHS,
        to: args.RESULTS_STAGING_PATH,
        concurrency: args.fileProcessingConcurrency,
    });
    const result = await Promise.all([
        args.host?.init(args.clean),
        copyResultsFiles,
        args.downloadRequired ? storage?.stageFilesFromStorage() : undefined,
    ]);
    console.log("Files staged successfully.");
    return result;
}
async function generateAllureReport({ allure, reportUrl, }) {
    console.log("Generating Allure report...");
    const result = await allure.generate(createExecutor(reportUrl));
    console.log("Report generated successfully!");
    return result;
}
function createExecutor(reportUrl) {
    const buildName = `GitHub Run ID: ${github.context.runId}`;
    return {
        name: "Allure Deployer Action",
        reportUrl,
        buildUrl: createGitHubBuildUrl(),
        buildName,
        buildOrder: github.context.runNumber,
        type: "github",
    };
}
function createGitHubBuildUrl() {
    const { context } = github;
    return `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
}
async function finalizeDeployment({ args, storage, }) {
    console.log("Finalizing deployment...");
    const result = await Promise.all([
        getReportStats(path.join(args.REPORTS_DIR, "widgets/summary.json")),
        args.host?.deploy(),
        storage?.uploadArtifacts(),
    ]);
    console.log("Deployment finalized.");
    return result;
}
async function sendNotifications(args, resultsStats, reportUrl) {
    const notifiers = [new ConsoleNotifier(args)];
    const slackChannel = core.getInput("slack_channel");
    const slackToken = core.getInput("slack_token");
    if (validateSlackConfig(slackChannel, slackToken)) {
        const slackClient = new SlackService({ channel: slackChannel, token: slackToken });
        notifiers.push(new SlackNotifier(slackClient, args));
    }
    const dashboardUrl = process.env.DEBUG === 'true' && args.storageBucket && args.firebaseProjectId
        ? getDashboardUrl({ storageBucket: args.storageBucket, projectId: args.firebaseProjectId })
        : undefined;
    const githubNotifierClient = new GitHubService();
    const token = core.getInput("github_token");
    const prNumber = github.context.payload.pull_request?.number;
    const prComment = core.getBooleanInput("pr_comment");
    notifiers.push(new GitHubNotifier({ client: githubNotifierClient, token, prNumber, prComment }));
    const notificationData = new NotificationData(resultsStats, reportUrl, dashboardUrl);
    await new NotifyHandler(notifiers).sendNotifications(notificationData);
}
function handleStorageError(error) {
    const errorMessage = {
        403: "Access denied. Ensure the Cloud Storage API is enabled and credentials have proper permissions.",
        404: "Bucket not found. Verify the bucket name and its existence.",
    };
    console.error(errorMessage[error.code] || `An unexpected error occurred: ${error.message}`);
}
