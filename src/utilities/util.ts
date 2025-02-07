import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import process from "node:process";
import {SlackConfig} from "allure-deployer-shared";
import path from "node:path";
import {GOOGLE_CREDENTIALS_PATH} from "./constants.js";
import core from "@actions/core";

type ServiceAccountJson = {
    "type": string,
    "project_id": string,
    "private_key_id": any,
    "private_key": any,
    "client_email": any,
    "client_id": any,
    "auth_uri": any,
    "token_uri": any,
    "auth_provider_x509_cert_url": any,
    "client_x509_cert_url": any,
    "universe_domain": any
}

export const ERROR_MESSAGES = {
    EMPTY_RESULTS: "Error: The specified results directory is empty.",
    NO_RESULTS_DIR: "Error: No Allure result files in the specified directory.",
    MISSING_CREDENTIALS: "Error: Firebase/GCP credentials must be set using 'gcp-json:set' or provided via '--gcp-json'.",
    MISSING_BUCKET: "Storage bucket not provided. History and Retries will not be available in report.",
    INVALID_SLACK_CRED: `Invalid Slack credential. 'slack_channel' and 'slack_token' must be provided together`,
    NO_JAVA: 'Error: JAVA_HOME not found. Allure 2.32 requires JAVA runtime installed'
};


export async function setGoogleCredentialsEnv(gcpJson: string): Promise<ServiceAccountJson> {
    try {
        const serviceAccount =  JSON.parse(gcpJson) as ServiceAccountJson;
        await fs.mkdir(path.dirname(GOOGLE_CREDENTIALS_PATH), { recursive: true });
        await fs.writeFile(GOOGLE_CREDENTIALS_PATH, JSON.stringify(serviceAccount, null, 2), 'utf8');
        process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_CREDENTIALS_PATH;
        return serviceAccount;
    } catch (e) {
        console.error('Error: Failed to set Google Credentials file',e);
        process.exit(1)
    }
}


export function validateSlackConfig(channel: string, token: string): SlackConfig | undefined {
    // Check if only one of the variables is provided
    if ((channel && !token) || (!channel && token)) {
        console.warn(ERROR_MESSAGES.INVALID_SLACK_CRED);
    }
    if(channel && token) {
        return {channel, token};
    }
    return undefined;
}

/**
 * Configuration for retry logic
 */
export interface RetryConfig {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
    backoffFactor: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    initialDelay: 1000, // 1 second
    maxDelay: 10000,    // 10 seconds
    backoffFactor: 2
};

/**
 * Determines if an error is retryable based on its status code
 */
export function isRetryableError(error: any): boolean {
    // GitHub API error status codes that are worth retrying
    const retryableStatusCodes = [
        408, // Request Timeout
        429, // Too Many Requests
        500, // Internal Server Error
        502, // Bad Gateway
        503, // Service Unavailable
        504  // Gateway Timeout
    ];

    return (
        error.status && retryableStatusCodes.includes(error.status) ||
        error.message?.includes('rate limit') ||
        error.message?.includes('timeout') ||
        error.message?.includes('network error')
    );
}

/**
 * Utility function to implement retry logic with exponential backoff
 * @param operation - Function to retry
 * @param config - Retry configuration
 * @returns Result of the operation
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
    let lastError: Error | null = null;
    let delay = config.initialDelay;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;

            // Don't retry if it's not a retryable error
            if (!isRetryableError(error)) {
                throw error;
            }

            // If this was our last attempt, throw the error
            if (attempt === config.maxRetries) {
                throw new Error(
                    `Failed after ${config.maxRetries} attempts. Last error: ${lastError?.message || "Unknown error"}`
                );
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));

            // Calculate next delay with exponential backoff
            delay = Math.min(delay * config.backoffFactor, config.maxDelay);

            console.warn(
                `Attempt ${attempt} failed. Retrying in ${delay}ms. Error: ${error.message}`
            );
        }
    }

    throw lastError; // TypeScript needs this
}

// Function to recursively read absolute file paths in a directory
export function getAbsoluteFilePaths(dir: string): string[] {
    const filesAndDirs = fsSync.readdirSync(dir); // Read directory contents
    const filePaths: string[] = []; // To store absolute file paths

    for (const entry of filesAndDirs) {
        const fullPath = path.resolve(dir, entry); // Resolve to absolute path
        const stats = fsSync.statSync(fullPath);

        if (stats.isDirectory()) {
            // If entry is a directory, recurse into it
            filePaths.push(...getAbsoluteFilePaths(fullPath));
        } else if (stats.isFile()) {
            // If entry is a file, add its absolute path to the list
            filePaths.push(fullPath);
        }
    }

    return filePaths;
}

export function getInputOrUndefined(name: string): string | undefined {
    const input = core.getInput(name);
    return input !== '' ? input : undefined;
}




