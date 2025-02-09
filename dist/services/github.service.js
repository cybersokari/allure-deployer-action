import github from "@actions/github";
import core from "@actions/core";
export class GitHubService {
    async updateOutput({ name, value }) {
        try {
            core.setOutput(name, value);
        }
        catch (e) {
        }
    }
    async updatePr({ message, token, prNumber }) {
        try {
            // Update the PR body
            await github.getOctokit(token).rest.issues.createComment({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                issue_number: prNumber,
                body: message,
            });
            console.log(`Pull Request #${prNumber} updated successfully!`);
        }
        catch (e) {
            console.warn('Failed to update PR:', e);
        }
    }
    async updateSummary(message) {
        await core.summary.addRaw(message, true).write();
    }
}
