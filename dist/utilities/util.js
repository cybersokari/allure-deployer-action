import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import process from "node:process";
import path from "node:path";
import { GOOGLE_CREDENTIALS_PATH } from "./constants.js";
import core from "@actions/core";
export const ERROR_MESSAGES = {
    EMPTY_RESULTS: "Error: The specified results directory is empty.",
    NO_RESULTS_DIR: "Error: No Allure result files in the specified directory.",
    MISSING_CREDENTIALS: "Error: Firebase/GCP credentials must be set using 'gcp-json:set' or provided via '--gcp-json'.",
    MISSING_BUCKET: "Storage bucket not provided. History and Retries will not be available in report.",
    INVALID_SLACK_CRED: `Invalid Slack credential. 'slack_channel' and 'slack_token' must be provided together`,
    NO_JAVA: 'Error: JAVA_HOME not found. Allure 2.32 requires JAVA runtime installed'
};
export async function setGoogleCredentialsEnv(gcpJson) {
    try {
        const serviceAccount = JSON.parse(gcpJson);
        await fs.mkdir(path.dirname(GOOGLE_CREDENTIALS_PATH), { recursive: true });
        await fs.writeFile(GOOGLE_CREDENTIALS_PATH, JSON.stringify(serviceAccount, null, 2), 'utf8');
        process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_CREDENTIALS_PATH;
        return serviceAccount;
    }
    catch (e) {
        console.error('Error: Failed to set Google Credentials file', e);
        process.exit(1);
    }
}
export function validateSlackConfig(channel, token) {
    // Check if only one of the variables is provided
    if ((channel && !token) || (!channel && token)) {
        console.warn(ERROR_MESSAGES.INVALID_SLACK_CRED);
    }
    if (channel && token) {
        return { channel, token };
    }
    return undefined;
}
/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2
};
/**
 * Determines if an error is retryable based on its status code
 */
export function isRetryableError(error) {
    // GitHub API error status codes that are worth retrying
    const retryableStatusCodes = [
        408,
        429,
        500,
        502,
        503,
        504 // Gateway Timeout
    ];
    return (error.status && retryableStatusCodes.includes(error.status) ||
        error.message?.includes('rate limit') ||
        error.message?.includes('timeout') ||
        error.message?.includes('network error'));
}
/**
 * Utility function to implement retry logic with exponential backoff
 * @param operation - Function to retry
 * @param config - Retry configuration
 * @returns Result of the operation
 */
export async function withRetry(operation, config = DEFAULT_RETRY_CONFIG) {
    let lastError = null;
    let delay = config.initialDelay;
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            // Don't retry if it's not a retryable error
            if (!isRetryableError(error)) {
                throw error;
            }
            // If this was our last attempt, throw the error
            if (attempt === config.maxRetries) {
                throw new Error(`Failed after ${config.maxRetries} attempts. Last error: ${lastError?.message || "Unknown error"}`);
            }
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
            // Calculate next delay with exponential backoff
            delay = Math.min(delay * config.backoffFactor, config.maxDelay);
            console.warn(`Attempt ${attempt} failed. Retrying in ${delay}ms. Error: ${error.message}`);
        }
    }
    throw lastError; // TypeScript needs this
}
// Function to recursively read absolute file paths in a directory
export function getAbsoluteFilePaths(dir) {
    const filesAndDirs = fsSync.readdirSync(dir); // Read directory contents
    const filePaths = []; // To store absolute file paths
    for (const entry of filesAndDirs) {
        const fullPath = path.resolve(dir, entry); // Resolve to absolute path
        const stats = fsSync.statSync(fullPath);
        if (stats.isDirectory()) {
            // If entry is a directory, recurse into it
            filePaths.push(...getAbsoluteFilePaths(fullPath));
        }
        else if (stats.isFile()) {
            // If entry is a file, add its absolute path to the list
            filePaths.push(fullPath);
        }
    }
    return filePaths;
}
export function getInputOrUndefined(name) {
    const input = core.getInput(name);
    return input !== '' ? input : undefined;
}
