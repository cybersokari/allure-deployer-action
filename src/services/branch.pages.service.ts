import {PagesInterface} from "../interfaces/pages.interface.js";
import {Octokit} from "@octokit/rest";
import pLimit from "p-limit";
import fs from "fs";
import path from "node:path";
import {DEFAULT_RETRY_CONFIG, RetryConfig, withRetry} from "../utilities/util.js";

type GitHubTree = {
    path?: string | undefined;
    mode?: "100644" | "100755" | "040000" | "160000" | "120000" | undefined;
    type?: "blob" | "tree" | "commit" | undefined;
    sha?: string | null | undefined;
    content?: string | undefined;
}
export type GitHubConfig = {
    owner: string;
    repo: string;
    branch: string;
    runId: string;
    subFolder: string;
    filesDir: string;
    retryConfig?: RetryConfig;
    token: string
}

export class BranchPagesService implements PagesInterface {
    private octokit: Octokit;
    public readonly branch: string;
    public readonly subFolder: string;
    private readonly filesDir: string;
    private readonly retryConfig: RetryConfig;
    readonly repo: string;
    readonly owner: string;
    private readonly runId: string;

    constructor({
                    branch,
                    filesDir,
                    retryConfig = DEFAULT_RETRY_CONFIG,
                    token, repo, runId, subFolder, owner
                }: GitHubConfig) {
        this.octokit = new Octokit({auth: token});
        this.branch = branch;
        this.filesDir = filesDir;
        this.retryConfig = retryConfig;
        this.owner = owner
        this.repo = repo
        this.subFolder = subFolder
        this.runId = runId
    }

    async deployPages(): Promise<void> {
        if (!fs.existsSync(this.filesDir)) {
            throw new Error(`Directory does not exist: ${this.filesDir}`);
        }
        const owner = this.owner;
        const repo = this.repo;

        // Get parent commit SHA with retry logic
        let latestCommitSha: string;
        try {
            latestCommitSha = await withRetry(async () => {
                try {
                    const branchRef = await this.octokit.git.getRef({
                        owner,
                        repo,
                        ref: `heads/${this.branch}`
                    });
                    return branchRef.data.object.sha;
                } catch (error: any) {
                    if (error.status === 404) {
                        const defaultBranch = (await this.octokit.repos.get({owner, repo}))
                            .data.default_branch;
                        const defaultBranchRef = await this.octokit.git.getRef({
                            owner,
                            repo,
                            ref: `heads/${defaultBranch}`
                        });
                        return defaultBranchRef.data.object.sha;
                    }
                    throw error;
                }
            }, this.retryConfig);
        } catch (error) {
            console.error('Failed to get commit SHA:', error);
            throw error;
        }

        // Get base tree with retry
        const baseTreeSha = await withRetry(async () => {
            const latestCommit = await this.octokit.git.getCommit({
                owner,
                repo,
                commit_sha: latestCommitSha
            });
            return latestCommit.data.tree.sha;
        }, this.retryConfig);

        // Prepare tree objects for all files
        const files = this.getFilesFromDir(this.filesDir);
        if (files.length === 0) {
            console.warn(
                `No files found in the directory: ${this.filesDir}. Deployment aborted.`
            );
            return;
        }

        // Create blobs with rate limiting and retry logic
        const limit = pLimit(50);
        const tree: GitHubTree[] = await Promise.all(
            files.map((file) =>
                limit(async () => {
                    const relativePath = path.posix.relative(this.filesDir, file);
                    const repoPath = path.join(this.subFolder, relativePath);
                    const content = fs.readFileSync(file, "utf8");

                    const blob = await withRetry(async () =>
                            this.octokit.git.createBlob({
                                owner,
                                repo,
                                content,
                                encoding: "utf-8",
                            })
                        , this.retryConfig);

                    return <GitHubTree>{
                        path: repoPath,
                        mode: "100644",
                        type: "blob",
                        sha: blob.data.sha,
                    };
                })
            )
        );

        // Create new tree with retry
        const newTree = await withRetry(async () =>
                this.octokit.git.createTree({
                    owner,
                    repo,
                    tree,
                    base_tree: baseTreeSha,
                })
            , this.retryConfig);

        // Create new commit with retry
        const newCommit = await withRetry(async () =>
                this.octokit.git.createCommit({
                    owner,
                    repo,
                    message: `GitHub Pages ${this.runId}`,
                    tree: newTree.data.sha,
                    parents: [latestCommitSha],
                })
            , this.retryConfig);

        // Update branch reference with retry
        await withRetry(async () =>
                this.octokit.git.updateRef({
                    owner,
                    repo,
                    ref: `heads/${this.branch}`,
                    sha: newCommit.data.sha,
                })
            , this.retryConfig);

        console.log("Deployment to GitHub Pages complete with a single commit.");
    }

    async setup(): Promise<string> {
        const owner = this.owner;
        const repo = this.repo;

        try {
            await withRetry(async () =>
                    this.octokit.rest.repos.getBranch({
                        owner,
                        repo,
                        branch: this.branch
                    })
                , this.retryConfig);
        } catch (error: any) {
            if (error.status === 404) {
                const defaultBranch = await withRetry(async () =>
                        (await this.octokit.repos.get({owner, repo})).data.default_branch
                    , this.retryConfig);

                const sha = await withRetry(async () =>
                        (await this.octokit.git.getRef({
                            owner,
                            repo,
                            ref: `heads/${defaultBranch}`
                        })).data.object.sha
                    , this.retryConfig);

                const ref = `refs/heads/${this.branch}`;
                await withRetry(async () =>
                        this.octokit.git.createRef({owner, repo, ref, sha})
                    , this.retryConfig);
            } else {
                throw error;
            }
        }
        return `https://${this.owner}.github.io/${this.repo}/${this.subFolder}`
    }

    private getFilesFromDir(dir: string): string[] {
        const files: string[] = [];

        const readDir = (currentDir: string) => {
            const entries = fs.readdirSync(currentDir, {withFileTypes: true});
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    readDir(fullPath);
                } else {
                    files.push(fullPath);
                }
            }
        };

        readDir(dir);
        return files;
    }
}