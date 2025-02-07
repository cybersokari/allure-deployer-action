import {PagesInterface} from "../interfaces/pages.interface.js";
import {Octokit} from "@octokit/rest";
import {DefaultArtifactClient} from "@actions/artifact";
import {getAbsoluteFilePaths} from "../utilities/util.js";
import github from "@actions/github";
import * as tar from "tar";
import * as os from "node:os";
import path from "node:path";

export interface ArtifactPagesConfig {
    owner: string;
    repo: string;
    token: string;
    idToken: string;
    reportDir: string;
}
export class ArtifactPagesService implements PagesInterface{
    readonly owner: string;
    readonly repo: string;
    private octokit: Octokit;
    artifactClient: DefaultArtifactClient;
    private readonly reportDir: string;
    private artifactId?: number
    private readonly idToken: string

    constructor({owner, repo, token, idToken, reportDir}: ArtifactPagesConfig) {
        this.idToken = idToken;
        this.reportDir = reportDir
        this.owner = owner
        this.repo = repo
        this.octokit = new Octokit({auth: token})
        this.artifactClient = new DefaultArtifactClient()
    }

    async deployPages(): Promise<string> {
        if(!this.artifactId) throw new Error('No artifact id found. Call setup() before deployPages()');
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
        })
        console.log(`page response ${JSON.stringify(response.data)}`);
        return response.data.page_url
    }

    async setup(): Promise<string> {
        const tarPath = path.join(os.tmpdir(), 'artifact.tar')
        const files = getAbsoluteFilePaths(this.reportDir)
        await this.createArchive(files, this.reportDir, tarPath)
        const response = await this.artifactClient.uploadArtifact('github-pages', [tarPath], path.dirname(tarPath), {retentionDays: 1})
        this.artifactId = response.id!
        return ''
    }

    // Function to create a tar archive
    async createArchive(files: string[], filesSource: string, outputPath: string): Promise<void> {
        console.log('::group::Archive artifact');

        if (files.length === 0) {
            console.warn('No files to archive.');
            return;
        }

        // Create the tar archive
        await new Promise((resolve, reject) => {
            tar.create(
                {
                    // file: outputPath,
                    gzip: false,
                    cwd: filesSource,
                    sync: false, file: outputPath
                },
                files,
                (e)=> {
                    if(e){
                        reject(e);
                    } else {
                        resolve(true);
                    }
                }
            );
        })


        console.log(`Archive created at: ${outputPath}`);
        console.log('::endgroup::');
    }
}