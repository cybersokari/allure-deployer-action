import {PagesInterface} from "../../interfaces/pages.interface";
import {HostingProvider} from "allure-deployer-shared";

export class GithubHost implements HostingProvider{
    constructor(readonly client: PagesInterface) {
    }
    async deploy(): Promise<any> {
        await this.client.deployPages();
    }

    async init(): Promise<string> {
        return await this.client.setup()
    }

}