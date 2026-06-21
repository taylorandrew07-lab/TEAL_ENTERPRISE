// Write-side server actions for the Accounting module. Mutations go through RLS
// (writes require the relevant permission; super admin bypasses). On failure we
// redirect back with an ?error= so the screen can surface it.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { accountingDb } from './context';

function back(path: string, error?: string): never {
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

export async function createAccount(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/accounts', 'No active company');
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const account_type_id = String(formData.get('account_type_id') ?? '');
  const is_bank_account = formData.get('is_bank_account') === 'on';
  if (!code || !name || !account_type_id) back('/accounting/accounts', 'Code, name and type are required');

  const { error } = await acc
    .from('accounts')
    .insert({ company_id: companyId, code, name, account_type_id, is_bank_account });
  if (error) back('/accounting/accounts', error.message);
  revalidatePath('/accounting/accounts');
  back('/accounting/accounts');
}

// A pragmatic Trinidad & Tobago starter chart, mapped to the seeded account types.
const STARTER_CHART: { code: string; name: string; typeKey: string; bank?: boolean }[] = [
  { code: '1000', name: 'Cash at Bank', typeKey: 'bank', bank: true },
  { code: '1010', name: 'Petty Cash', typeKey: 'current_asset' },
  { code: '1100', name: 'Accounts Receivable', typeKey: 'accounts_receivable' },
  { code: '1200', name: 'Prepaid Expenses', typeKey: 'current_asset' },
  { code: '1500', name: 'Equipment & Vehicles', typeKey: 'fixed_asset' },
  { code: '1510', name: 'Accumulated Depreciation', typeKey: 'fixed_asset' },
  { code: '2000', name: 'Accounts Payable', typeKey: 'accounts_payable' },
  { code: '2100', name: 'VAT Payable', typeKey: 'tax_liability' },
  { code: '2200', name: 'PAYE Payable', typeKey: 'tax_liability' },
  { code: '2300', name: 'NIS Payable', typeKey: 'tax_liability' },
  { code: '2500', name: 'Loans Payable', typeKey: 'long_term_liability' },
  { code: '3000', name: 'Share Capital', typeKey: 'equity' },
  { code: '3100', name: 'Retained Earnings', typeKey: 'retained_earnings' },
  { code: '4000', name: 'Service Revenue', typeKey: 'income' },
  { code: '4100', name: 'Survey & Assurance Revenue', typeKey: 'income' },
  { code: '4900', name: 'Other Income', typeKey: 'other_income' },
  { code: '5000', name: 'Cost of Services', typeKey: 'cost_of_goods_sold' },
  { code: '6000', name: 'Salaries & Wages', typeKey: 'expense' },
  { code: '6100', name: 'Rent', typeKey: 'expense' },
  { code: '6200', name: 'Utilities', typeKey: 'expense' },
  { code: '6300', name: 'Office Expenses', typeKey: 'expense' },
  { code: '6400', name: 'Professional Fees', typeKey: 'expense' },
  { code: '6500', name: 'Bank Charges', typeKey: 'expense' },
  { code: '6900', name: 'Depreciation', typeKey: 'expense' },
  { code: '7000', name: 'Other Expenses', typeKey: 'other_expense' },
];

export async function seedStarterChart(): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/accounts', 'No active company');

  const { data: types } = await acc.from('account_types').select('id, key');
  const idByKey = new Map((types ?? []).map((t: { id: string; key: string }) => [t.key, t.id]));

  const rows = STARTER_CHART.filter((a) => idByKey.has(a.typeKey)).map((a) => ({
    company_id: companyId,
    code: a.code,
    name: a.name,
    account_type_id: idByKey.get(a.typeKey)!,
    is_bank_account: Boolean(a.bank),
  }));

  const { error } = await acc.from('accounts').insert(rows);
  if (error) back('/accounting/accounts', error.message);
  revalidatePath('/accounting/accounts');
  back('/accounting/accounts');
}
