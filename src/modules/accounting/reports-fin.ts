// Financial reports for the Accounting module: Profit & Loss, Balance Sheet, and
// General Ledger detail. All are derived from the accounting.general_ledger view
// (posted journal lines only), in the company's base currency, aggregated in JS.
// Read-side only; runs through RLS as the current user, scoped to the active company.
import { accountingDb } from './context';
import type { AccountCategory } from './queries';

const r2 = (n: number) => Math.round(n * 100) / 100;

// One enriched, posted journal line as exposed by the general_ledger view.
interface GLRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_category: AccountCategory;
  entry_date: string;
  entry_no: string | null;
  description: string | null;
  base_debit: number;
  base_credit: number;
}

const GL_COLUMNS =
  'account_id, account_code, account_name, account_category, entry_date, entry_no, description, base_debit, base_credit';

/** Pull every posted GL line for the active company, in base currency. */
async function fetchGL(): Promise<GLRow[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc.from('general_ledger').select(GL_COLUMNS).eq('company_id', companyId);
  return ((data as any[] | null) ?? []).map((row) => ({
    account_id: row.account_id,
    account_code: row.account_code,
    account_name: row.account_name,
    account_category: row.account_category,
    entry_date: row.entry_date,
    entry_no: row.entry_no,
    description: row.description,
    base_debit: Number(row.base_debit || 0),
    base_credit: Number(row.base_credit || 0),
  }));
}

// -----------------------------------------------------------------------------
// Profit & Loss
// -----------------------------------------------------------------------------
export interface PLAccountRow {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: number;
}

export interface ProfitAndLoss {
  income: PLAccountRow[];
  expenses: PLAccountRow[];
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  hasData: boolean;
}

/**
 * Income (category 'income') shown credit-natural (credit − debit); expenses
 * ('expense') shown debit-natural (debit − credit). Net profit = income − expenses.
 * One row per account; accounts with no net movement are dropped.
 */
export async function profitAndLoss(): Promise<ProfitAndLoss> {
  const rows = await fetchGL();
  const hasData = rows.length > 0;

  const acc = new Map<string, { account_code: string; account_name: string; debit: number; credit: number }>();
  for (const row of rows) {
    if (row.account_category !== 'income' && row.account_category !== 'expense') continue;
    let m = acc.get(row.account_id);
    if (!m) {
      m = { account_code: row.account_code, account_name: row.account_name, debit: 0, credit: 0 };
      acc.set(row.account_id, m);
    }
    m.debit += row.base_debit;
    m.credit += row.base_credit;
  }

  const income: PLAccountRow[] = [];
  const expenses: PLAccountRow[] = [];
  for (const [account_id, m] of acc) {
    const isIncome = rows.find((r) => r.account_id === account_id)!.account_category === 'income';
    const amount = r2(isIncome ? m.credit - m.debit : m.debit - m.credit);
    if (amount === 0) continue;
    const out = { account_id, account_code: m.account_code, account_name: m.account_name, amount };
    (isIncome ? income : expenses).push(out);
  }

  income.sort((a, b) => a.account_code.localeCompare(b.account_code));
  expenses.sort((a, b) => a.account_code.localeCompare(b.account_code));

  const totalIncome = r2(income.reduce((s, r) => s + r.amount, 0));
  const totalExpenses = r2(expenses.reduce((s, r) => s + r.amount, 0));
  return { income, expenses, totalIncome, totalExpenses, netProfit: r2(totalIncome - totalExpenses), hasData };
}

// -----------------------------------------------------------------------------
// Balance Sheet
// -----------------------------------------------------------------------------
export interface BSAccountRow {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: number;
}

export interface BalanceSheet {
  assets: BSAccountRow[];
  liabilities: BSAccountRow[];
  equity: BSAccountRow[];
  currentYearEarnings: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number; // includes current-year earnings
  balanced: boolean;
  hasData: boolean;
}

/**
 * Cumulative balances from all posted lines. Assets are debit-natural (debit −
 * credit); liabilities and equity are credit-natural (credit − debit). Income −
 * expenses becomes "Current-year earnings" and sits under equity so the sheet
 * balances: Assets == Liabilities + Equity (+ earnings).
 */
export async function balanceSheet(): Promise<BalanceSheet> {
  const rows = await fetchGL();
  const hasData = rows.length > 0;

  const acc = new Map<
    string,
    { account_code: string; account_name: string; category: AccountCategory; debit: number; credit: number }
  >();
  let income = 0;
  let expenses = 0;

  for (const row of rows) {
    if (row.account_category === 'income') {
      income += row.base_credit - row.base_debit;
      continue;
    }
    if (row.account_category === 'expense') {
      expenses += row.base_debit - row.base_credit;
      continue;
    }
    let m = acc.get(row.account_id);
    if (!m) {
      m = { account_code: row.account_code, account_name: row.account_name, category: row.account_category, debit: 0, credit: 0 };
      acc.set(row.account_id, m);
    }
    m.debit += row.base_debit;
    m.credit += row.base_credit;
  }

  const assets: BSAccountRow[] = [];
  const liabilities: BSAccountRow[] = [];
  const equity: BSAccountRow[] = [];
  for (const [account_id, m] of acc) {
    const debitNatural = m.category === 'asset';
    const amount = r2(debitNatural ? m.debit - m.credit : m.credit - m.debit);
    if (amount === 0) continue;
    const out = { account_id, account_code: m.account_code, account_name: m.account_name, amount };
    if (m.category === 'asset') assets.push(out);
    else if (m.category === 'liability') liabilities.push(out);
    else equity.push(out); // equity
  }

  const byCode = (a: BSAccountRow, b: BSAccountRow) => a.account_code.localeCompare(b.account_code);
  assets.sort(byCode);
  liabilities.sort(byCode);
  equity.sort(byCode);

  const currentYearEarnings = r2(income - expenses);
  const totalAssets = r2(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = r2(liabilities.reduce((s, r) => s + r.amount, 0));
  const totalEquity = r2(equity.reduce((s, r) => s + r.amount, 0) + currentYearEarnings);
  const balanced = Math.round((totalAssets - totalLiabilities - totalEquity) * 100) === 0;

  return {
    assets,
    liabilities,
    equity,
    currentYearEarnings,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced,
    hasData,
  };
}

// -----------------------------------------------------------------------------
// General Ledger detail
// -----------------------------------------------------------------------------
export interface GLLine {
  entry_date: string;
  entry_no: string | null;
  description: string | null;
  debit: number;
  credit: number;
  balance: number; // running balance after this line
}

export interface GLAccount {
  account_id: string;
  account_code: string;
  account_name: string;
  category: AccountCategory;
  opening: number; // always 0 here — the GL view carries no prior-period carry-forward
  lines: GLLine[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

export interface GeneralLedger {
  accounts: GLAccount[];
  hasData: boolean;
}

/**
 * Posted lines grouped by account (ordered by code). Each account carries its
 * lines with a running balance, plus opening (0) and closing figures. The running
 * balance follows the account's natural side: debit-natural for assets/expenses,
 * credit-natural for liabilities/equity/income.
 */
export async function generalLedger(): Promise<GeneralLedger> {
  const rows = await fetchGL();
  const hasData = rows.length > 0;

  const groups = new Map<string, GLRow[]>();
  for (const row of rows) {
    const arr = groups.get(row.account_id);
    if (arr) arr.push(row);
    else groups.set(row.account_id, [row]);
  }

  const accounts: GLAccount[] = [];
  for (const [account_id, glRows] of groups) {
    const first = glRows[0];
    const debitNatural = first.account_category === 'asset' || first.account_category === 'expense';

    glRows.sort(
      (a, b) =>
        a.entry_date.localeCompare(b.entry_date) ||
        (a.entry_no ?? '').localeCompare(b.entry_no ?? ''),
    );

    let balance = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    const lines: GLLine[] = glRows.map((row) => {
      totalDebit += row.base_debit;
      totalCredit += row.base_credit;
      balance += debitNatural ? row.base_debit - row.base_credit : row.base_credit - row.base_debit;
      return {
        entry_date: row.entry_date,
        entry_no: row.entry_no,
        description: row.description,
        debit: r2(row.base_debit),
        credit: r2(row.base_credit),
        balance: r2(balance),
      };
    });

    accounts.push({
      account_id,
      account_code: first.account_code,
      account_name: first.account_name,
      category: first.account_category,
      opening: 0,
      lines,
      totalDebit: r2(totalDebit),
      totalCredit: r2(totalCredit),
      closing: r2(balance),
    });
  }

  accounts.sort((a, b) => a.account_code.localeCompare(b.account_code));
  return { accounts, hasData };
}
