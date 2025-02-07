export class GithubHost {
    constructor(client) {
        this.client = client;
    }
    async deploy() {
        return await this.client.deployPages();
    }
    async init() {
        return await this.client.setup();
    }
}
