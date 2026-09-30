/**
 * 身分驗證供應者抽象（04 §2）。P3 只交付本機 email+密碼實作；
 * OIDC（Google/Apple/magic link，Auth0/Keycloak/Supabase）為「未驗證」，需要時新增實作並在設定切換。
 */
export interface AuthProvider {
  readonly name: string;
  /** 驗證帳密；成功回 userId，失敗回 null（不區分「沒有帳號」與「密碼錯」） */
  verify(email: string, password: string): Promise<string | null>;
  /** 本機供應者支援註冊；外部 IdP 則由 IdP 建帳號 */
  register?(input: {
    email: string;
    password: string;
    displayName?: string;
    locale?: string;
  }): Promise<string>;
}
