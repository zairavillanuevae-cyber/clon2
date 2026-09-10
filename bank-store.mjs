import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const nowIso = () => new Date().toISOString();
const money = (value) => Math.round(Number(value) * 100);
const accountNumber = () =>
  `TR${crypto.randomInt(10, 100)} ${Array.from({ length: 5 }, () => crypto.randomInt(0, 10000).toString().padStart(4, '0')).join(' ')}`;
const cardNumber = () =>
  Array.from({ length: 4 }, () => crypto.randomInt(0, 10000).toString().padStart(4, '0')).join(' ');
const cardExpiry = () =>
  `${String(new Date().getMonth() + 1).padStart(2, '0')}/${String((new Date().getFullYear() + 4) % 100).padStart(2, '0')}`;
const cardCvv = () => crypto.randomInt(0, 1000).toString().padStart(3, '0');
const publicAccount = (row, isPrimary = false) => ({
  id: row.id,
  accountNumber: row.account_number,
  currency: row.currency,
  balance: Number(row.balance_cents) / 100,
  isPrimary,
  createdAt: row.created_at
});
const publicCustomer = (row, extraAccounts = row.secondary_accounts || []) => ({
  id: row.id,
  username: row.username,
  name: row.name,
  accountNumber: row.account_number,
  cardNumber: row.card_number,
  cardExpiry: row.card_expiry,
  cardCvv: row.card_cvv,
  cardStatus: row.card_status || 'active',
  currency: row.currency,
  balance: Number(row.balance_cents) / 100,
  createdAt: row.created_at,
  accounts: [publicAccount(row, true), ...extraAccounts.map((account) => publicAccount(account, false))]
});

export function passwordHash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

export function createMemoryBankStore({
  username = 'customer.portal',
  password = 'Portal2026!',
  openingBalance = 12840.5
} = {}) {
  const salt = crypto.randomBytes(16).toString('hex');
  const customer = {
    id: crypto.randomUUID(),
    username,
    name: 'Primary Customer',
    account_number: 'TR00 0000 0000 0000 0000 0001',
    card_number: '4543 6701 1000 0001',
    card_expiry: '09/30',
    card_cvv: '271',
    card_status: 'active',
    currency: 'USD',
    balance_cents: money(openingBalance),
    password_salt: salt,
    password_hash: passwordHash(password, salt),
    active: true,
    created_at: nowIso(),
    secondary_accounts: []
  };
  const customers = new Map([[customer.id, customer]]);
  const transactions = [
    {
      id: 1,
      customerId: customer.id,
      type: 'opening',
      amount: openingBalance,
      description: 'Opening balance',
      actor: 'system',
      createdAt: nowIso()
    }
  ];
  const messages = [];
  let transactionId = 1;
  let messageId = 0;
  return {
    async close() {},
    async authenticate(user, pass) {
      const row = [...customers.values()].find((item) => item.username === user && item.active);
      return row && passwordHash(pass, row.password_salt) === row.password_hash ? publicCustomer(row) : null;
    },
    async getCustomer(id) {
      const row = customers.get(id);
      return row?.active ? publicCustomer(row) : null;
    },
    async listCustomers() {
      return [...customers.values()].filter((item) => item.active).map((item) => publicCustomer(item));
    },
    async createCustomer({
      name,
      username: newUsername,
      password: newPassword,
      currency,
      openingBalance: initialBalance,
      accountNumber: requestedAccountNumber,
      cardNumber: requestedCardNumber,
      cardExpiry: requestedCardExpiry,
      cardCvv: requestedCardCvv
    }) {
      if ([...customers.values()].some((item) => item.username === newUsername)) return { error: 'username_exists' };
      const createdAt = nowIso();
      const customerSalt = crypto.randomBytes(16).toString('hex');
      const balanceCents = money(initialBalance);
      const row = {
        id: crypto.randomUUID(),
        username: newUsername,
        name,
        account_number: requestedAccountNumber || accountNumber(),
        card_number: requestedCardNumber || cardNumber(),
        card_expiry: requestedCardExpiry || cardExpiry(),
        card_cvv: requestedCardCvv || cardCvv(),
        card_status: 'active',
        currency,
        balance_cents: balanceCents,
        password_salt: customerSalt,
        password_hash: passwordHash(newPassword, customerSalt),
        active: true,
        created_at: createdAt,
        secondary_accounts: []
      };
      customers.set(row.id, row);
      if (balanceCents > 0)
        transactions.push({
          id: ++transactionId,
          customerId: row.id,
          type: 'opening',
          amount: balanceCents / 100,
          description: 'Opening balance',
          actor: 'operator',
          createdAt
        });
      return { customer: publicCustomer(row) };
    },
    async createAccount({ customerId, currency, openingBalance, accountNumber: requestedAccountNumber }) {
      const row = customers.get(customerId);
      if (!row?.active) return { error: 'not_found' };
      if ([row, ...row.secondary_accounts].some((account) => account.currency === currency))
        return { error: 'currency_exists' };
      const number = requestedAccountNumber || accountNumber();
      if (
        [...customers.values()].some((item) =>
          [item, ...item.secondary_accounts].some((account) => account.account_number === number)
        )
      )
        return { error: 'account_number_exists' };
      const createdAt = nowIso();
      const balanceCents = money(openingBalance);
      const account = {
        id: crypto.randomUUID(),
        customer_id: customerId,
        account_number: number,
        currency,
        balance_cents: balanceCents,
        created_at: createdAt
      };
      row.secondary_accounts.push(account);
      if (balanceCents > 0)
        transactions.push({
          id: ++transactionId,
          customerId,
          accountId: account.id,
          currency,
          accountNumber: number,
          type: 'opening',
          amount: balanceCents / 100,
          description: 'Opening balance',
          actor: 'operator',
          createdAt,
          showDate: true
        });
      return { customer: publicCustomer(row), account: publicAccount(account) };
    },
    async deleteCustomer(id) {
      const row = customers.get(id);
      if (!row?.active) return false;
      row.active = false;
      return true;
    },
    async setCardStatus(id, status) {
      const row = customers.get(id);
      if (!row?.active) return null;
      row.card_status = status;
      return publicCustomer(row);
    },
    async setCardNumber(id, newCardNumber) {
      const row = customers.get(id);
      if (!row?.active) return { error: 'not_found' };
      if ([...customers.values()].some((item) => item.id !== id && item.card_number === newCardNumber))
        return { error: 'card_number_exists' };
      row.card_number = newCardNumber;
      return { customer: publicCustomer(row) };
    },
    async getTransactions(id, limit = 100) {
      const customer = customers.get(id);
      return transactions
        .filter((item) => item.customerId === id)
        .slice(-limit)
        .reverse()
        .map((item) => {
          const account = customer?.secondary_accounts.find((candidate) => candidate.id === item.accountId);
          return {
            ...item,
            accountId: item.accountId || id,
            currency: item.currency || account?.currency || customer?.currency || 'USD',
            accountNumber: item.accountNumber || account?.account_number || customer?.account_number
          };
        });
    },
    async transact({
      customerId,
      accountId = customerId,
      type,
      amount,
      description,
      actor,
      createdAt = nowIso(),
      showDate = true,
      reversalDueAt = null
    }) {
      const activeCustomer = customers.get(customerId);
      if (!activeCustomer) return { error: 'not_found' };
      const activeAccount =
        accountId === customerId
          ? activeCustomer
          : activeCustomer.secondary_accounts.find((account) => account.id === accountId);
      if (!activeAccount) return { error: 'account_not_found' };
      const cents = money(amount);
      if (!Number.isSafeInteger(cents) || cents <= 0) return { error: 'invalid_amount' };
      const debit = type === 'withdrawal' || type === 'debit' || type === 'payment';
      if (debit && activeAccount.balance_cents < cents) return { error: 'insufficient_funds' };
      activeAccount.balance_cents += debit ? -cents : cents;
      const row = {
        id: ++transactionId,
        customerId,
        accountId,
        currency: activeAccount.currency,
        accountNumber: activeAccount.account_number,
        type,
        amount: cents / 100,
        description,
        actor,
        createdAt,
        showDate,
        reversalDueAt,
        reversedAt: null,
        relatedTransactionId: null,
        notificationDismissed: false
      };
      transactions.push(row);
      return {
        customer: publicCustomer(activeCustomer),
        account: publicAccount(activeAccount, accountId === customerId),
        transaction: row
      };
    },
    async processDueReversals(customerId, currentTime = Date.now()) {
      const activeCustomer = customers.get(customerId);
      if (!activeCustomer?.active) return [];
      const reversed = [];
      for (const transaction of transactions) {
        if (
          transaction.customerId !== customerId ||
          transaction.type !== 'withdrawal' ||
          !transaction.reversalDueAt ||
          transaction.reversedAt ||
          new Date(transaction.reversalDueAt).getTime() > currentTime
        )
          continue;
        const createdAt = nowIso();
        transaction.reversedAt = createdAt;
        activeCustomer.balance_cents += money(transaction.amount);
        const reversal = {
          id: ++transactionId,
          customerId,
          type: 'reversal',
          amount: transaction.amount,
          description: `Returned transfer: ${transaction.description}`.slice(0, 180),
          actor: 'system',
          createdAt,
          showDate: true,
          reversalDueAt: null,
          reversedAt: null,
          relatedTransactionId: transaction.id,
          notificationDismissed: false
        };
        transactions.push(reversal);
        reversed.push(reversal);
      }
      return reversed;
    },
    async getNotifications(customerId) {
      return transactions
        .filter(
          (transaction) =>
            transaction.customerId === customerId &&
            transaction.type === 'reversal' &&
            !transaction.notificationDismissed
        )
        .map((transaction) => ({
          id: transaction.id,
          type: 'transfer_reversed',
          amount: transaction.amount,
          relatedTransactionId: transaction.relatedTransactionId,
          createdAt: transaction.createdAt
        }));
    },
    async dismissNotification(customerId, notificationId) {
      const transaction = transactions.find(
        (item) => item.id === notificationId && item.customerId === customerId && item.type === 'reversal'
      );
      if (!transaction) return false;
      transaction.notificationDismissed = true;
      return true;
    },
    async getMessages(id, after = 0) {
      return messages.filter((item) => item.customerId === id && item.id > after);
    },
    async addMessage({
      customerId,
      sender,
      body,
      type = 'text',
      imageUrl = null,
      fileUrl = null,
      mimeType = null,
      fileSize = null
    }) {
      if (!customers.has(customerId)) return null;
      const row = {
        id: ++messageId,
        customerId,
        sender,
        body,
        type,
        imageUrl,
        fileUrl,
        mimeType,
        fileSize,
        createdAt: nowIso()
      };
      messages.push(row);
      return row;
    }
  };
}

export async function createBankStore(databaseUrl = process.env.DATABASE_URL) {
  const seed = {
    username: process.env.BANK_CUSTOMER_USER || process.env.BANK_DEMO_USER || 'customer.portal',
    password: process.env.BANK_CUSTOMER_PASSWORD || process.env.BANK_DEMO_PASSWORD || 'Portal2026!',
    openingBalance: Number(process.env.BANK_OPENING_BALANCE || 12840.5)
  };
  if (!databaseUrl) return createMemoryBankStore(seed);
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bank_customers (
      id UUID PRIMARY KEY, username VARCHAR(80) UNIQUE NOT NULL, name VARCHAR(120) NOT NULL,
      account_number VARCHAR(40) UNIQUE NOT NULL, currency VARCHAR(3) NOT NULL DEFAULT 'USD',
      card_number VARCHAR(24) UNIQUE, card_expiry VARCHAR(5), card_cvv VARCHAR(4),
      card_status VARCHAR(12) NOT NULL DEFAULT 'active',
      balance_cents BIGINT NOT NULL DEFAULT 0, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bank_transactions (
      id BIGSERIAL PRIMARY KEY, customer_id UUID NOT NULL REFERENCES bank_customers(id),
      type VARCHAR(24) NOT NULL, amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
      description VARCHAR(180) NOT NULL, actor VARCHAR(20) NOT NULL,
      show_date BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bank_messages (
      id BIGSERIAL PRIMARY KEY, customer_id UUID NOT NULL REFERENCES bank_customers(id),
      sender VARCHAR(20) NOT NULL CHECK (sender IN ('customer','operator')), body VARCHAR(2000) NOT NULL,
      type VARCHAR(16) NOT NULL DEFAULT 'text' CHECK (type IN ('text','image','file')), image_url TEXT,
      file_url TEXT, mime_type VARCHAR(160), file_size BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bank_customer_accounts (
      id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES bank_customers(id) ON DELETE CASCADE,
      account_number VARCHAR(40) UNIQUE NOT NULL, currency VARCHAR(3) NOT NULL,
      balance_cents BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(customer_id, currency)
    );
    CREATE INDEX IF NOT EXISTS bank_transactions_customer_idx ON bank_transactions(customer_id, id DESC);
    CREATE INDEX IF NOT EXISTS bank_messages_customer_idx ON bank_messages(customer_id, id);
  `);
  await pool.query('ALTER TABLE bank_customers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE');
  await pool.query('ALTER TABLE bank_customers ADD COLUMN IF NOT EXISTS card_number VARCHAR(24) UNIQUE');
  await pool.query('ALTER TABLE bank_customers ADD COLUMN IF NOT EXISTS card_expiry VARCHAR(5)');
  await pool.query('ALTER TABLE bank_customers ADD COLUMN IF NOT EXISTS card_cvv VARCHAR(4)');
  await pool.query(
    "ALTER TABLE bank_customers ADD COLUMN IF NOT EXISTS card_status VARCHAR(12) NOT NULL DEFAULT 'active'"
  );
  await pool.query('ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS show_date BOOLEAN NOT NULL DEFAULT TRUE');
  await pool.query('ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reversal_due_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS related_transaction_id BIGINT');
  await pool.query('ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS account_id UUID');
  await pool.query('UPDATE bank_transactions SET account_id=customer_id WHERE account_id IS NULL');
  await pool.query(
    'ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS notification_dismissed BOOLEAN NOT NULL DEFAULT FALSE'
  );
  await pool.query("ALTER TABLE bank_messages ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'text'");
  await pool.query('ALTER TABLE bank_messages ADD COLUMN IF NOT EXISTS image_url TEXT');
  await pool.query('ALTER TABLE bank_messages ADD COLUMN IF NOT EXISTS file_url TEXT');
  await pool.query('ALTER TABLE bank_messages ADD COLUMN IF NOT EXISTS mime_type VARCHAR(160)');
  await pool.query('ALTER TABLE bank_messages ADD COLUMN IF NOT EXISTS file_size BIGINT');
  await pool.query('ALTER TABLE bank_messages DROP CONSTRAINT IF EXISTS bank_messages_type_check');
  await pool.query(
    "ALTER TABLE bank_messages ADD CONSTRAINT bank_messages_type_check CHECK (type IN ('text','image','file'))"
  );
  const salt = crypto.randomBytes(16).toString('hex');
  const id = crypto.randomUUID();
  const inserted = await pool.query(
    `INSERT INTO bank_customers (id, username, name, account_number, balance_cents, password_salt, password_hash)
    VALUES ($1,$2,'Primary Customer','TR00 0000 0000 0000 0000 0001',$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
    [id, seed.username, money(seed.openingBalance), salt, passwordHash(seed.password, salt)]
  );
  if (inserted.rowCount)
    await pool.query(
      "INSERT INTO bank_transactions (customer_id,account_id,type,amount_cents,description,actor) VALUES ($1,$1,'opening',$2,'Opening balance','system')",
      [id, money(seed.openingBalance)]
    );
  await pool.query(
    'UPDATE bank_customers SET card_number=COALESCE(card_number,$1), card_expiry=COALESCE(card_expiry,$2), card_cvv=COALESCE(card_cvv,$3) WHERE username=$4',
    [cardNumber(), cardExpiry(), cardCvv(), seed.username]
  );
  const customersMissingCard = await pool.query(
    'SELECT id FROM bank_customers WHERE card_number IS NULL OR card_expiry IS NULL OR card_cvv IS NULL'
  );
  for (const row of customersMissingCard.rows)
    await pool.query(
      'UPDATE bank_customers SET card_number=COALESCE(card_number,$2), card_expiry=COALESCE(card_expiry,$3), card_cvv=COALESCE(card_cvv,$4) WHERE id=$1',
      [row.id, cardNumber(), cardExpiry(), cardCvv()]
    );
  const getAccounts = async (customerId, client = pool) => {
    const { rows } = await client.query(
      'SELECT * FROM bank_customer_accounts WHERE customer_id=$1 ORDER BY created_at,id',
      [customerId]
    );
    return rows;
  };
  const hydratedCustomer = async (row, client = pool) =>
    row ? publicCustomer(row, await getAccounts(row.id, client)) : null;
  return {
    async close() {
      await pool.end();
    },
    async authenticate(username, password) {
      const { rows } = await pool.query('SELECT * FROM bank_customers WHERE username=$1 AND active=TRUE', [username]);
      const row = rows[0];
      return row && passwordHash(password, row.password_salt) === row.password_hash ? hydratedCustomer(row) : null;
    },
    async getCustomer(id) {
      const { rows } = await pool.query('SELECT * FROM bank_customers WHERE id=$1 AND active=TRUE', [id]);
      return hydratedCustomer(rows[0]);
    },
    async listCustomers() {
      const { rows } = await pool.query('SELECT * FROM bank_customers WHERE active=TRUE ORDER BY created_at');
      return Promise.all(rows.map((row) => hydratedCustomer(row)));
    },
    async createCustomer({
      name,
      username,
      password,
      currency,
      openingBalance,
      accountNumber: requestedAccountNumber,
      cardNumber: requestedCardNumber,
      cardExpiry: requestedCardExpiry,
      cardCvv: requestedCardCvv
    }) {
      const client = await pool.connect();
      const id = crypto.randomUUID();
      const salt = crypto.randomBytes(16).toString('hex');
      const balanceCents = money(openingBalance);
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'INSERT INTO bank_customers (id,username,name,account_number,card_number,card_expiry,card_cvv,currency,balance_cents,password_salt,password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
          [
            id,
            username,
            name,
            requestedAccountNumber || accountNumber(),
            requestedCardNumber || cardNumber(),
            requestedCardExpiry || cardExpiry(),
            requestedCardCvv || cardCvv(),
            currency,
            balanceCents,
            salt,
            passwordHash(password, salt)
          ]
        );
        if (balanceCents > 0)
          await client.query(
            "INSERT INTO bank_transactions (customer_id,account_id,type,amount_cents,description,actor) VALUES ($1,$1,'opening',$2,'Opening balance','operator')",
            [id, balanceCents]
          );
        const customer = await hydratedCustomer(rows[0], client);
        await client.query('COMMIT');
        return { customer };
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') return { error: 'username_exists' };
        throw error;
      } finally {
        client.release();
      }
    },
    async createAccount({ customerId, currency, openingBalance, accountNumber: requestedAccountNumber }) {
      const client = await pool.connect();
      const id = crypto.randomUUID();
      const number = requestedAccountNumber || accountNumber();
      const balanceCents = money(openingBalance);
      try {
        await client.query('BEGIN');
        const customerResult = await client.query(
          'SELECT * FROM bank_customers WHERE id=$1 AND active=TRUE FOR UPDATE',
          [customerId]
        );
        if (!customerResult.rowCount) {
          await client.query('ROLLBACK');
          return { error: 'not_found' };
        }
        const duplicateCurrency = await client.query(
          'SELECT 1 FROM bank_customer_accounts WHERE customer_id=$1 AND currency=$2',
          [customerId, currency]
        );
        if (customerResult.rows[0].currency === currency || duplicateCurrency.rowCount) {
          await client.query('ROLLBACK');
          return { error: 'currency_exists' };
        }
        const duplicateNumber = await client.query(
          'SELECT 1 FROM bank_customers WHERE account_number=$1 UNION ALL SELECT 1 FROM bank_customer_accounts WHERE account_number=$1 LIMIT 1',
          [number]
        );
        if (duplicateNumber.rowCount) {
          await client.query('ROLLBACK');
          return { error: 'account_number_exists' };
        }
        const accountResult = await client.query(
          'INSERT INTO bank_customer_accounts (id,customer_id,account_number,currency,balance_cents) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [id, customerId, number, currency, balanceCents]
        );
        if (balanceCents > 0)
          await client.query(
            "INSERT INTO bank_transactions (customer_id,account_id,type,amount_cents,description,actor) VALUES ($1,$2,'opening',$3,'Opening balance','operator')",
            [customerId, id, balanceCents]
          );
        const customer = await hydratedCustomer(customerResult.rows[0], client);
        await client.query('COMMIT');
        return { customer, account: publicAccount(accountResult.rows[0]) };
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') return { error: 'account_exists' };
        throw error;
      } finally {
        client.release();
      }
    },
    async deleteCustomer(id) {
      const result = await pool.query('UPDATE bank_customers SET active=FALSE WHERE id=$1 AND active=TRUE', [id]);
      return result.rowCount === 1;
    },
    async setCardStatus(id, status) {
      const { rows } = await pool.query(
        'UPDATE bank_customers SET card_status=$2 WHERE id=$1 AND active=TRUE RETURNING *',
        [id, status]
      );
      return hydratedCustomer(rows[0]);
    },
    async setCardNumber(id, newCardNumber) {
      try {
        const { rows } = await pool.query(
          'UPDATE bank_customers SET card_number=$2 WHERE id=$1 AND active=TRUE RETURNING *',
          [id, newCardNumber]
        );
        return rows[0] ? { customer: await hydratedCustomer(rows[0]) } : { error: 'not_found' };
      } catch (error) {
        if (error.code === '23505') return { error: 'card_number_exists' };
        throw error;
      }
    },
    async getTransactions(customerId, limit = 100) {
      const { rows } = await pool.query(
        `SELECT t.id,t.customer_id AS "customerId",COALESCE(t.account_id,t.customer_id) AS "accountId",
          t.type,t.amount_cents::float/100 AS amount,t.description,t.actor,t.show_date AS "showDate",
          t.created_at AS "createdAt",COALESCE(a.currency,c.currency) AS currency,
          COALESCE(a.account_number,c.account_number) AS "accountNumber"
        FROM bank_transactions t JOIN bank_customers c ON c.id=t.customer_id
        LEFT JOIN bank_customer_accounts a ON a.id=t.account_id
        WHERE t.customer_id=$1 ORDER BY t.id DESC LIMIT $2`,
        [customerId, limit]
      );
      return rows;
    },
    async transact({
      customerId,
      accountId = customerId,
      type,
      amount,
      description,
      actor,
      createdAt = nowIso(),
      showDate = true,
      reversalDueAt = null
    }) {
      const cents = money(amount);
      if (!Number.isSafeInteger(cents) || cents <= 0) return { error: 'invalid_amount' };
      const debit = type === 'withdrawal' || type === 'debit' || type === 'payment';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await client.query('SELECT * FROM bank_customers WHERE id=$1 AND active=TRUE FOR UPDATE', [
          customerId
        ]);
        if (!current.rowCount) {
          await client.query('ROLLBACK');
          return { error: 'not_found' };
        }
        const secondary = accountId !== customerId;
        const currentAccount = secondary
          ? await client.query('SELECT * FROM bank_customer_accounts WHERE id=$1 AND customer_id=$2 FOR UPDATE', [
              accountId,
              customerId
            ])
          : current;
        if (!currentAccount.rowCount) {
          await client.query('ROLLBACK');
          return { error: 'account_not_found' };
        }
        if (debit && Number(currentAccount.rows[0].balance_cents) < cents) {
          await client.query('ROLLBACK');
          return { error: 'insufficient_funds' };
        }
        const updated = secondary
          ? await client.query(
              'UPDATE bank_customer_accounts SET balance_cents=balance_cents+$2 WHERE id=$1 RETURNING *',
              [accountId, debit ? -cents : cents]
            )
          : await client.query('UPDATE bank_customers SET balance_cents=balance_cents+$2 WHERE id=$1 RETURNING *', [
              customerId,
              debit ? -cents : cents
            ]);
        const tx = await client.query(
          'INSERT INTO bank_transactions (customer_id,account_id,type,amount_cents,description,actor,show_date,created_at,reversal_due_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,customer_id AS "customerId",account_id AS "accountId",type,amount_cents::float/100 AS amount,description,actor,show_date AS "showDate",created_at AS "createdAt",reversal_due_at AS "reversalDueAt"',
          [customerId, accountId, type, cents, description, actor, showDate, createdAt, reversalDueAt]
        );
        const extraAccounts = await getAccounts(customerId, client);
        const customer = publicCustomer(secondary ? current.rows[0] : updated.rows[0], extraAccounts);
        const account = publicAccount(updated.rows[0], !secondary);
        await client.query('COMMIT');
        return {
          customer,
          account,
          transaction: {
            ...tx.rows[0],
            currency: updated.rows[0].currency,
            accountNumber: updated.rows[0].account_number
          }
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async processDueReversals(customerId) {
      const client = await pool.connect();
      const reversals = [];
      try {
        await client.query('BEGIN');
        const pending = await client.query(
          "SELECT id,account_id,amount_cents,description FROM bank_transactions WHERE customer_id=$1 AND type='withdrawal' AND reversal_due_at<=NOW() AND reversed_at IS NULL FOR UPDATE",
          [customerId]
        );
        for (const transaction of pending.rows) {
          const createdAt = nowIso();
          await client.query('UPDATE bank_customers SET balance_cents=balance_cents+$2 WHERE id=$1', [
            customerId,
            transaction.amount_cents
          ]);
          const reversal = await client.query(
            'INSERT INTO bank_transactions (customer_id,account_id,type,amount_cents,description,actor,related_transaction_id,created_at) VALUES ($1,$1,\'reversal\',$2,$3,\'system\',$4,$5) RETURNING id,customer_id AS "customerId",account_id AS "accountId",type,amount_cents::float/100 AS amount,description,actor,related_transaction_id AS "relatedTransactionId",created_at AS "createdAt"',
            [
              customerId,
              transaction.amount_cents,
              `Returned transfer: ${transaction.description}`.slice(0, 180),
              transaction.id,
              createdAt
            ]
          );
          await client.query('UPDATE bank_transactions SET reversed_at=$2 WHERE id=$1', [transaction.id, createdAt]);
          reversals.push(reversal.rows[0]);
        }
        await client.query('COMMIT');
        return reversals;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async getNotifications(customerId) {
      const { rows } = await pool.query(
        'SELECT id,\'transfer_reversed\' AS type,amount_cents::float/100 AS amount,related_transaction_id AS "relatedTransactionId",created_at AS "createdAt" FROM bank_transactions WHERE customer_id=$1 AND type=\'reversal\' AND notification_dismissed=FALSE ORDER BY id',
        [customerId]
      );
      return rows;
    },
    async dismissNotification(customerId, notificationId) {
      const result = await pool.query(
        "UPDATE bank_transactions SET notification_dismissed=TRUE WHERE id=$1 AND customer_id=$2 AND type='reversal'",
        [notificationId, customerId]
      );
      return result.rowCount === 1;
    },
    async getMessages(customerId, after = 0) {
      const { rows } = await pool.query(
        'SELECT id,customer_id AS "customerId",sender,body,type,image_url AS "imageUrl",file_url AS "fileUrl",mime_type AS "mimeType",file_size AS "fileSize",created_at AS "createdAt" FROM bank_messages WHERE customer_id=$1 AND id>$2 ORDER BY id LIMIT 500',
        [customerId, after]
      );
      return rows;
    },
    async addMessage({
      customerId,
      sender,
      body,
      type = 'text',
      imageUrl = null,
      fileUrl = null,
      mimeType = null,
      fileSize = null
    }) {
      const { rows } = await pool.query(
        'INSERT INTO bank_messages (customer_id,sender,body,type,image_url,file_url,mime_type,file_size) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,customer_id AS "customerId",sender,body,type,image_url AS "imageUrl",file_url AS "fileUrl",mime_type AS "mimeType",file_size AS "fileSize",created_at AS "createdAt"',
        [customerId, sender, body, type, imageUrl, fileUrl, mimeType, fileSize]
      );
      return rows[0] || null;
    }
  };
}
