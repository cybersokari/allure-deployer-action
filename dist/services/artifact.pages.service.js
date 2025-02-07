import { Octokit } from "@octokit/rest";
import { DefaultArtifactClient } from "@actions/artifact";
import { getAbsoluteFilePaths } from "../utilities/util.js";
import github from "@actions/github";
export class ArtifactPagesService {
    constructor({ owner, repo, token, idToken, reportDir }) {
        this.idToken = idToken;
        this.reportDir = reportDir;
        this.owner = owner;
        this.repo = repo;
        this.octokit = new Octokit({ auth: token });
        this.artifactClient = new DefaultArtifactClient();
    }
    async deployPages() {
        if (!this.artifactId)
            throw new Error('No artifact id found. Call setup() before deployPages()');
        // const environment = getInputOrUndefined('environment');
        // if(!environment)  throw new Error('No environment found. GitHub pages environment must be set');
        const response = await this.octokit.request('POST /repos/{owner}/{repo}/pages/deployments', {
            owner: this.owner,
            repo: this.repo,
            artifact_id: this.artifactId,
            pages_build_version: github.context.sha,
            oidc_token: this.idToken,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        return response.data.page_url;
    }
    async setup() {
        const files = getAbsoluteFilePaths(this.reportDir);
        const response = await this.artifactClient.uploadArtifact('allure-reports', files, this.reportDir, { retentionDays: 1 });
        this.artifactId = response.id;
        return '';
    }
}
