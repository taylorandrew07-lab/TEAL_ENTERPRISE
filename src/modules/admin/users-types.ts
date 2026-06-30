// Shared types for Administration → Users. Kept out of the 'use server' module
// (which may only export async functions) so both the server actions and the
// client UI can import the shape.
export interface CompanyMember {
  membershipId: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  isSuperAdmin: boolean;
  isSelf: boolean;
  grantedKeys: string[];
}
