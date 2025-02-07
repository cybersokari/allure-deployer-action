import * as process from "node:process";
import path from "node:path";
import { Allure, ConsoleNotifier, copyFiles, FirebaseHost, FirebaseService, getReportStats, getRuntimeDirectory, GoogleStorage, GoogleStorageService, NotifyHandler, SlackNotifier, SlackService, validateResultsPaths, } from "allure-deployer-shared";
import { Storage as GCPStorage } from "@google-cloud/storage";
import { NotifierService } from "./services/notifier.service.js";
import { GitHubNotifier } from "./features/messaging/github-notifier.js";
import { BranchPagesService } from "./services/branch.pages.service.js";
import { GithubHost } from "./features/hosting/github.host.js";
import github from "@actions/github";
import core from "@actions/core";
import { setGoogleCredentialsEnv, validateSlackConfig } from "./utilities/util.js";
import { Target } from "./interfaces/args.interface.js";
import { ArtifactService } from "./services/artifact.service.js";
import { GithubStorage } from "./features/github-storage.js";
import { ArtifactPagesService } from "./services/artifact.pages.service.js";
function getTarget() {
    const target = core.getInput("target", { required: true }).toLowerCase();
    if (!["firebase", "github"].includes(target)) {
        console.log("Error: target must be either 'github' or 'firebase'.");
        process.exit(1);
    }
    return target === 'firebase' ? Target.FIREBASE : Target.GITHUB;
}
function getRetries() {
    const retries = core.getInput("retries");
    return parseInt(retries !== '' ? retries : "0", 10);
}
function getInputOrUndefined(name) {
    const input = core.getInput(name);
    return input !== '' ? input : undefined;
}
export function main() {
    (async () => {
        const target = getTarget();
        const resultsPaths = core.getInput("allure_results_path", { required: true });
        const showHistory = core.getBooleanInput("show_history");
        const retries = getRetries();
        const runtimeDir = await getRuntimeDirectory();
        const reportOutputPath = getInputOrUndefined('output');
        const REPORTS_DIR = reportOutputPath ? reportOutputPath : path.join(runtimeDir, "allure-report");
        const storageRequired = showHistory || retries > 0;
        const branch = getInputOrUndefined('github_pages_branch');
        const args = {
            downloadRequired: storageRequired,
            uploadRequired: storageRequired,
            runtimeCredentialDir: path.join(runtimeDir, "credentials/key.json"),
            fileProcessingConcurrency: 10,
            RESULTS_PATHS: await validateResultsPaths(resultsPaths),
            RESULTS_STAGING_PATH: path.join(runtimeDir, "allure-results"),
            ARCHIVE_DIR: path.join(runtimeDir, "archive"),
            REPORTS_DIR,
            retries,
            showHistory,
            storageRequired,
            target,
            branch,
            reportLanguage: getInputOrUndefined('language')
        };
        if (target === Target.FIREBASE) {
            const credentials = getInputOrUndefined("google_credentials_json");
            if (!credentials) {
                core.setFailed("Error: Firebase Hosting requires a valid 'google_credentials_json'.");
                return;
            }
            let firebaseProjectId = (await setGoogleCredentialsEnv(credentials)).project_id;
            args.googleCredentialData = credentials;
            args.firebaseProjectId = firebaseProjectId;
            args.host = getFirebaseHost({ firebaseProjectId, REPORTS_DIR });
            args.storageBucket = getInputOrUndefined('gcs_bucket');
        }
        else {
            const token = core.getInput("github_token");
            if (!token) {
                core.setFailed("Error: Github Pages require a 'github_token'.");
                return;
            }
            args.githubToken = token;
            args.host = await getGitHubHost({
                token,
                REPORTS_DIR,
                branch
            });
        }
        await executeDeployment(args);
    })();
}
async function executeDeployment(args) {
    try {
        const storage = args.storageRequired ? await initializeStorage(args) : undefined;
        const [reportUrl] = await stageDeployment(args, storage);
        const allure = new Allure({ args });
        await generateAllureReport({ allure, reportUrl });
        const [resultsStats] = await finalizeDeployment({ args, storage });
        await sendNotifications(args, resultsStats, reportUrl, allure.environments);
    }
    catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
    }
}
function getFirebaseHost({ firebaseProjectId, REPORTS_DIR }) {
    return new FirebaseHost(new FirebaseService(firebaseProjectId, REPORTS_DIR));
}
async function getGitHubHost({ token, REPORTS_DIR, branch }) {
    if (branch) {
        const config = {
            runId: github.context.runId.toString(),
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            subFolder: path.join(core.getInput('github_subfolder'), `${github.context.runNumber}`),
            branch,
            filesDir: REPORTS_DIR,
            token
        };
        return new GithubHost(new BranchPagesService(config));
    }
    else {
        try {
            const idToken = await core.getIDToken();
            const config = {
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                reportDir: REPORTS_DIR,
                token,
                idToken
            };
            return new GithubHost(new ArtifactPagesService(config));
        }
        catch (error) {
            console.log(error);
            core.setFailed(`Ensure GITHUB_TOKEN has permission "id-token: write".`);
            throw error;
        }
    }
}
async function initializeStorage(args) {
    switch (args.target) {
        case Target.GITHUB: {
            return new GithubStorage(new ArtifactService(args.githubToken), args);
        }
        case Target.FIREBASE: {
            if (args.storageBucket && args.googleCredentialData) {
                return new GoogleStorage(await getCloudStorageService({
                    storageBucket: args.storageBucket,
                    googleCredentialData: args.googleCredentialData
                }), args);
            }
            else if (!args.storageBucket) {
                console.log('No storage bucket provided. History and Retries will be disabled.');
            }
            return undefined;
        }
        default:
            return undefined;
    }
}
async function getCloudStorageService({ storageBucket, googleCredentialData }) {
    try {
        const credentials = JSON.parse(googleCredentialData);
        const bucket = new GCPStorage({ credentials }).bucket(storageBucket);
        const [exists] = await bucket.exists();
        if (!exists) {
            console.log(`GCP storage bucket '${bucket.name}' does not exist. History and Retries will be disabled.`);
            process.exit(1);
        }
        return new GoogleStorageService(bucket, getInputOrUndefined('gcs_bucket_prefix'));
    }
    catch (error) {
        handleStorageError(error);
        process.exit(1);
    }
}
async function stageDeployment(args, storage) {
    console.log("Staging files...");
    const copyResultsFiles = copyFiles({
        from: args.RESULTS_PATHS,
        to: args.RESULTS_STAGING_PATH,
        concurrency: args.fileProcessingConcurrency,
    });
    const initHost = async () => {
        const host = args.host;
        if (!host) {
            return undefined;
        }
        // Artifact pages deployments do not require init during staging
        if (host instanceof GithubHost && host.client instanceof ArtifactPagesService) {
            return undefined;
        }
        const url = await host.init();
        if (!url) { // remove empty string
            return undefined;
        }
        return url;
    };
    const result = await Promise.all([
        initHost(),
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
    const reportName = getInputOrUndefined('report_name');
    return {
        reportName: reportName ?? 'Allure Report',
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
    const deploySite = async () => {
        const host = args.host;
        if (!host) {
            return undefined;
        }
        // Artifact pages require init during deployment
        if (host instanceof GithubHost && host.client instanceof ArtifactPagesService) {
            await host.init();
        }
        return await host.deploy();
    };
    const result = await Promise.all([
        getReportStats(args.REPORTS_DIR),
        deploySite(),
        storage?.uploadArtifacts(),
    ]);
    console.log("Deployment finalized.");
    return result;
}
async function sendNotifications(args, resultStatus, reportUrl, environment) {
    const notifiers = [new ConsoleNotifier(args)];
    const slackChannel = core.getInput("slack_channel");
    const slackToken = core.getInput("slack_token");
    if (validateSlackConfig(slackChannel, slackToken)) {
        const slackClient = new SlackService({ channel: slackChannel, token: slackToken });
        notifiers.push(new SlackNotifier(slackClient, args));
    }
    const token = args.githubToken;
    const prNumber = github.context.payload.pull_request?.number;
    const prComment = core.getBooleanInput("pr_comment");
    const githubNotifierClient = new NotifierService();
    notifiers.push(new GitHubNotifier({ client: githubNotifierClient, token, prNumber, prComment }));
    const notificationData = { resultStatus, reportUrl, environment };
    await new NotifyHandler(notifiers).sendNotifications(notificationData);
}
function handleStorageError(error) {
    const errorMessage = {
        403: "Access denied. Ensure the Cloud Storage API is enabled and credentials have proper permissions.",
        404: "Bucket not found. Verify the bucket name and its existence.",
    };
    console.error(errorMessage[error.code] || `An unexpected error occurred: ${error.message}`);
}
