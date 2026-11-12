export type AdminRole = "editor" | "reviewer" | "publisher" | "auditor";
export interface AccountUser {
  accountId: string;
  username: string;
  role: "student" | "admin";
  adminRoles: AdminRole[];
}
export interface AccountRecord extends AccountUser {
  usernameKey: string;
  passwordHash: string;
  subjectId: string;
  createdAt: string;
}
export interface BootstrapAdmin {
  username: string;
  password: string;
  roles: AdminRole[];
}
export interface SessionView {
  authenticated: boolean;
  user: AccountUser | null;
  csrfToken: string | null;
  guest: boolean;
  guestHasData: boolean;
  features: {
    sampleData: boolean;
    modelEnabled: boolean;
    previewMode?: boolean;
  };
  notice?: string;
  guestDataMigrated?: boolean;
}
