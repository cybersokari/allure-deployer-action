import {PagesInterface} from "../../interfaces/pages.interface.js";
import {HostingProvider} from "allure-deployer-shared";

export class GithubHost implements HostingProvider{
    constructor(public readonly client: PagesInterface) {

    }
    async deploy(): Promise<string> {
        return await this.client.deployPages();
    }

    async init(): Promise<string> {
        return await this.client.setup()
    }

}