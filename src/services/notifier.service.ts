import { GithubInterface} from "../interfaces/github.interface.js";
import github from "@actions/github";
import core from "@actions/core";

export class NotifierService implements GithubInterface {

    async updateOutput({name, value}: { name: string, value: string }): Promise<void> {
        try {
            core.setOutput(name, value);
        } catch (e) {
        }
    }
    async updatePr({message, token, prNumber}: { message: string, token: string, prNumber: number }): Promise<void> {
        try {
            const octokit = github.getOctokit(token)
            // Update the PR body
            await octokit.rest.issues.createComment({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                issue_number: prNumber,
                body: message,
            });
            console.log(`Pull Request #${prNumber} updated successfully!`);
        } catch (e) {
            console.warn('Failed to update PR:', e);
        }
    }
    async updateSummary(message: string): Promise<void> {
        await core.summary.addRaw(message, true).write();
    }
}