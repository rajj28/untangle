import type { HttpCore } from "../http.ts";
import type { IdentityToken, IdentityUserInfo } from "../types.ts";

export function createIdentityResource(http: HttpCore, clientId: string) {
  return {
    authorizeUrl(q: { redirectUri: string; state: string; scope?: string }): string {
      const params = new URLSearchParams({
        flowEntry: "static",
        client_id: clientId,
        response_type: "code",
        scope: q.scope ?? "openid email profile",
        redirect_uri: q.redirectUri,
        state: q.state,
      });
      return `${http.webBase}/signin/authorize?${params.toString()}`;
    },

    async exchangeCode(code: string): Promise<IdentityToken> {
      return http.exchangeAuthorizationCode<IdentityToken>(code);
    },

    async userInfo(accessToken: string): Promise<IdentityUserInfo> {
      return http.request<IdentityUserInfo>("GET", "/v1/identity/openidconnect/userinfo", {
        query: { schema: "openid" },
        accessToken,
      });
    },
  };
}
