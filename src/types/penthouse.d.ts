declare module "penthouse" {
  type PenthouseOptions = {
    url: string;
    cssString: string;
    width?: number;
    height?: number;
    timeout?: number;
    keepLargerMediaQueries?: boolean;
    blockJSRequests?: boolean;
    pageLoadSkipTimeout?: number;
    renderWaitTime?: number;
    puppeteer?: {
      args?: string[];
      executablePath?: string;
      getBrowser?: () => Promise<unknown>;
    };
  };

  export default function penthouse(options: PenthouseOptions): Promise<string>;
}
