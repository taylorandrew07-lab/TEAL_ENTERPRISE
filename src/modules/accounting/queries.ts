// Read-side data access for the Accounting module (server components). All queries
// run through RLS as the current user; the active company scopes every result.
import { accountingDb } from './context';

export type AccountCategory = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type NormalBalance = 'debit' | 'credit';

export interface AccountType {
  id: string;
  key: string;
  name: string;
  category: AccountCategory;
  normal_balance: NormalBalance;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  is_bank_account: boolean;
  account_type_id: string;
  account_type: { name: string; category: AccountCategory; normal_balance: NormalBalance } | null;
}

export async function listAccountTypes(): Promise<AccountType[]> {
  const { acc } = await accountingDb();
  const { data } = await acc
    .from('account_types')
    .select('id, key, name, category, normal_balance')
    .order('category')
    .order('name');
  return (data as AccountType[] | null) ?? [];
}

export async function listAccounts(): Promise<Account[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('accounts')
    .select(
      'id, code, name, is_active, is_bank_account, account_type_id, account_type:account_types(name, category, normal_balance)',
    )
    .eq('company_id', companyId)
    .order('code');
  return (data as unknown as Account[] | null) ?? [];
}

const CATEGORY_ORDER: AccountCategory[] = ['asset', 'liability', 'equity', 'income', 'expense'];

export function groupAccountsByCategory(accounts: Account[]): { category: AccountCategory; accounts: Account[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    accounts: accounts.filter((a) => a.account_type?.category === category),
  })).filter((g) => g.accounts.length > 0);
}
