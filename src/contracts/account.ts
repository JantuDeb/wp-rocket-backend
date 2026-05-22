export type AccountSignupResponse = {
  account: {
    id: string;
    email: string;
    name?: string;
  };
  site: {
    id: string;
    url: string;
    domain: string;
  };
  api_key: {
    id: string;
    name: string;
    prefix: string;
    key: string;
  };
};

export type AccountMeResponse = {
  account: {
    id: string;
    email: string;
    name?: string;
  };
  site?: {
    id: string;
    url: string;
    domain: string;
  };
  api_key: {
    id: string;
    name: string;
    prefix: string;
  };
};
