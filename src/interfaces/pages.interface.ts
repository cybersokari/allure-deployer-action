export interface PagesInterface {
    owner: string;
    repo: string;
    deployPages(): Promise<any>;
    setup(): Promise<any>;
}