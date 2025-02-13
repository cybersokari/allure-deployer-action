import fs, {Dirent} from "fs";
import path from "node:path";
import simpleGit, {CheckRepoActions, SimpleGit} from "simple-git";
import github from "@actions/github";
import pLimit from "p-limit";
import core, {error, info} from "@actions/core";
import {RequestError} from "@octokit/request-error";
import normalizeUrl from "normalize-url";
import inputs from "../io.js";
import {GithubPagesInterface} from "../interfaces/github-pages.interface.js";

export type GitHubConfig = {
    owner: string;
    repo: string;
    branch: string;
    workspace: string;
    token: string;
    reportDir: string;
};

export class GithubPagesService implements GithubPagesInterface {
    private git: SimpleGit;
    readonly branch: string;
    readonly repo: string;
    readonly owner: string;
    private readonly token: string;
    private readonly workspace: string;
    private readonly reportDir: string;
    subFolder: string;
    private pageUrl?: string;

    constructor(config: GitHubConfig) {
        this.branch = config.branch;
        this.owner = config.owner;
        this.repo = config.repo;
        this.reportDir = config.reportDir;
        this.workspace = config.workspace;
        this.token = config.token;
        this.git = simpleGit({baseDir: this.workspace});
        this.subFolder = github.context.runId.toString();
    }

    /** Deploys the Allure report to GitHub Pages */
    async deployPages(): Promise<void> {
        await this.ensureValidState();
        const reportFiles = await this.getFilePathsFromDir(this.reportDir);

        if (reportFiles.length === 0) {
            core.error(`No files found in ${this.reportDir}. Deployment aborted.`);
            process.exit(1);
        }

        await this.git.add(reportFiles);
        await this.git.commit(`Allure report for GitHub run: ${github.context.runId}`);
        await this.git.push("origin", this.branch);

        console.log(`Allure report pages pushed to '${this.subFolder}' on '${this.branch}' branch`);
    }

    /** Ensures the repository and required directories are set up */
    private async ensureValidState(): Promise<void> {
        const [reportDirExists, isRepo] = await Promise.all([
            fs.existsSync(this.reportDir),
            this.git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)
        ]);
        if (!reportDirExists) {
            throw new Error(`Directory not found: ${this.reportDir}`);
        }
        if (!isRepo) {
            throw new Error("No repository found. Call setupBranch() to initialize.");
        }

        // await Promise.all([
        //     this.deleteOldReports(),
        //     this.createRedirectPage(normalizeUrl(`${this.pageUrl}/${this.subFolder}`))
        // ]) Running them together cause git lock issues
        await this.deleteOldReports();
        await this.createRedirectPage(normalizeUrl(`${this.pageUrl}/${this.subFolder}`));
    }

    /** Initializes and sets up the branch for GitHub Pages deployment */
    async setupBranch(): Promise<string> {
        const domain = await this.getPagesInfo();
        await this.git.init();

        const headers = {
            Authorization: `Basic ${Buffer.from(`x-access-token:${this.token}`).toString("base64")}`,
        };

        await this.git.addConfig(
            "http.https://github.com/.extraheader",
            `AUTHORIZATION: ${headers.Authorization}`,
            true,
            "local"
        );

        const actor = github.context.actor;
        const email = `${github.context.payload.sender?.id}+${actor}@users.noreply.github.com`;

        await this.git
            .addConfig("user.email", email, true, "local")
            .addConfig("user.name", actor, true, "local");

        const remote = `${github.context.serverUrl}/${this.owner}/${this.repo}.git`;
        await this.git.addRemote("origin", remote);

        const fetchResult = await this.git.fetch("origin", this.branch);

        if (fetchResult.branches.length === 0) {
            await this.createBranchFromDefault();
        } else {
            await this.git.checkoutBranch(this.branch, `origin/${this.branch}`);
        }

        return normalizeUrl(`${domain}/${this.subFolder}`);
    }

    /** Retrieves the GitHub Pages URL */
    private async getPagesInfo(): Promise<string> {
        try {
            const response = await github.getOctokit(this.token).rest.repos.getPages({
                owner: this.owner,
                repo: this.repo,
            });

            if (response.data.build_type !== "legacy" || response.data.source?.branch !== this.branch) {
                error(`GitHub Pages must be set to deploy from '${this.branch}' branch.`);
                process.exit(1);
            }

            const pagesPath = response.data.source.path.replace('/', '') // remove first '/'
            this.subFolder = path.posix.join(pagesPath, this.subFolder) // Append subFolder to Pages path
            this.pageUrl = response.data.html_url!;
            return this.pageUrl;
        } catch (e) {
            if (e instanceof RequestError) {
                error(e.message);
                process.exit(1);
            }
            throw e;
        }
    }

    /** Creates a redirect page for the Allure report */
    private async createRedirectPage(redirectUrl: string): Promise<void> {
        const htmlContent = `<!DOCTYPE html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; URL=${normalizeUrl(`${redirectUrl}/index.html`)}">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">`;

        const filePath = path.posix.join(this.workspace, "index.html");
        await fs.promises.writeFile(filePath, htmlContent);
        await this.git.add(filePath);
        info(`Redirect 'index.html' created at ${this.workspace}`);
    }

    /** Deletes old Allure reports, keeping the latest `inputs.keep` */
    private async deleteOldReports(): Promise<void> {
        try {
            const entries: Dirent[] = await fs.promises.readdir(this.workspace, {withFileTypes: true});
            const limit = pLimit(10);
            let paths = (
                await Promise.all(
                    entries.map((entry) =>
                        limit(async () => {
                            const reportIndexHtmlPath = path.posix.join(entry.parentPath, entry.name, 'index.html');
                            if (entry.isDirectory() && fs.existsSync(reportIndexHtmlPath)) {
                                return path.dirname(reportIndexHtmlPath); // Return directory name of index.html
                            }
                            return undefined
                        })
                    )
                )
            ).filter(Boolean) as string[];

            if (paths.length >= inputs.keep) {
                paths = await this.sortPathsByModifiedTime(paths)
                const pathsToDelete = paths.slice(0, paths.length - inputs.keep);
                await Promise.all(
                    pathsToDelete.map((pathToDelete) =>
                        limit(async () => {
                            await fs.promises.rm(pathToDelete, {recursive: true, force: true});
                            info(`Old Report deleted from '${pathToDelete}'`);
                        })
                    )
                );
                await this.git.add("-u");
            }
        } catch (e) {
            console.warn("Failed to delete old reports:", e);
        }
    }

    async sortPathsByModifiedTime(paths: string[]): Promise<string[]> {
        const limit = pLimit(5);
        const fileStats: Awaited<{ file: string; mtimeMs: number }>[] = await Promise.all(
            paths.map((file: string) => limit(async () => {
                const stats = await fs.promises.stat(file);
                return {file, mtimeMs: stats.mtimeMs};
            }))
        );
        fileStats.sort((a, b) => a.mtimeMs - b.mtimeMs);
        return fileStats.map((item) => item.file);
    }

    /** Recursively retrieves all file paths from a directory */
    private async getFilePathsFromDir(dir: string): Promise<string[]> {
        const files: string[] = [];
        const limit = pLimit(10);

        const readDirectory = async (currentDir: string) => {
            const entries: Dirent[] = await fs.promises.readdir(currentDir, {withFileTypes: true});

            await Promise.all(
                entries.map((entry) =>
                    limit(async () => {
                        const fullPath = path.join(currentDir, entry.name);
                        if (entry.isDirectory()) {
                            await readDirectory(fullPath);
                        } else {
                            files.push(fullPath);
                        }
                    })
                )
            );
        };

        await readDirectory(dir);
        return files;
    }

    /** Creates a branch from the default branch if it doesn't exist */
    private async createBranchFromDefault(): Promise<void> {
        const defaultBranch = (await this.git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"]))
            .trim()
            .split("/")
            .pop()!;

        await this.git.checkoutBranch(this.branch, `origin/${defaultBranch}`);
        console.log(`Branch '${this.branch}' created from '${defaultBranch}'.`);
    }
}