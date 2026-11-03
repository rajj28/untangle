export interface Money {
  currency_code: string;
  value: string;
}

export interface PayoutAmount {
  currency: string;
  value: string;
}

export interface PayPalClientConfig {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "live";
  allowLive?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
  timeoutMs?: number;
  onRequest?: (info: RequestInfoLog) => void;
}

export interface RequestInfoLog {
  method: string;
  path: string;
  status: number | null;
  attempt: number;
  durationMs: number;
  debugId: string | null;
  retrying: boolean;
}

export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "SCHEDULED"
  | "PAID"
  | "MARKED_AS_PAID"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_PAID"
  | "PARTIALLY_REFUNDED"
  | "MARKED_AS_REFUNDED"
  | "UNPAID"
  | "PAYMENT_PENDING";

export interface InvoiceInput {
  detail: {
    currency_code: string;
    invoice_number?: string;
    invoice_date?: string;
    note?: string;
    memo?: string;
    reference?: string;
    payment_term?: { term_type?: string; due_date?: string };
  };
  primary_recipients: {
    billing_info: {
      email_address: string;
      name?: { given_name?: string; surname?: string; business_name?: string };
    };
  }[];
  items: { name: string; description?: string; quantity: string; unit_amount: Money }[];
  configuration?: {
    partial_payment?: { allow_partial_payment: boolean; minimum_amount_due?: Money };
    allow_tip?: boolean;
  };
}

export interface Invoice {
  id: string;
  status: InvoiceStatus;
  detail: { invoice_number?: string; currency_code: string; reference?: string; note?: string; [key: string]: unknown };
  amount?: { value: string; currency_code: string; [key: string]: unknown };
  due_amount?: Money;
  payments?: {
    paid_amount?: Money;
    transactions?: {
      payment_id?: string;
      type?: string;
      method?: string;
      amount?: Money;
      note?: string;
      payment_date?: string;
      [key: string]: unknown;
    }[];
    [key: string]: unknown;
  };
  primary_recipients?: InvoiceInput["primary_recipients"];
  [key: string]: unknown;
}

export interface InvoiceSearch {
  status?: InvoiceStatus[];
  recipient_email?: string;
  invoice_number?: string;
  currency_code?: string;
  invoice_date_range?: { start: string; end: string };
}

export interface InvoiceSearchResult {
  items: Invoice[];
  total_items?: number;
  total_pages?: number;
}

export interface OrderInput {
  intent: "CAPTURE";
  purchase_units: {
    reference_id?: string;
    custom_id?: string;
    invoice_id?: string;
    description?: string;
    amount: Money;
    payee?: { email_address?: string; merchant_id?: string };
  }[];
}

export interface Order {
  id: string;
  status: string;
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    payments?: { captures?: Capture[]; [key: string]: unknown };
    [key: string]: unknown;
  }[];
  links?: { href: string; rel: string; method?: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

export interface Capture {
  id: string;
  status: string;
  amount?: Money;
  custom_id?: string;
  invoice_id?: string;
  create_time?: string;
  [key: string]: unknown;
}

export interface Refund {
  id: string;
  status: string;
  amount?: Money;
  [key: string]: unknown;
}

export interface PayoutInput {
  sender_batch_header: {
    sender_batch_id: string;
    email_subject?: string;
    email_message?: string;
  };
  items: {
    recipient_type: "EMAIL" | "PHONE" | "PAYPAL_ID" | "USER_HANDLE";
    receiver: string;
    amount: PayoutAmount;
    note?: string;
    sender_item_id?: string;
    recipient_wallet?: "PAYPAL" | "VENMO";
  }[];
}

export interface PayoutBatchHeaderResponse {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
    sender_batch_header?: { sender_batch_id?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PayoutItem {
  payout_item_id: string;
  transaction_id?: string;
  transaction_status?: string;
  payout_batch_id?: string;
  payout_item?: {
    recipient_type?: string;
    receiver?: string;
    amount?: PayoutAmount;
    sender_item_id?: string;
    recipient_wallet?: string;
    [key: string]: unknown;
  };
  errors?: unknown;
  [key: string]: unknown;
}

export interface PayoutBatch {
  batch_header: { payout_batch_id: string; batch_status: string; [key: string]: unknown };
  items?: PayoutItem[];
  [key: string]: unknown;
}

export interface TransactionSearchPage {
  transaction_details: {
    transaction_info: {
      transaction_id: string;
      transaction_status?: string;
      transaction_amount?: Money;
      transaction_initiation_date?: string;
      custom_field?: string;
      invoice_id?: string;
      [key: string]: unknown;
    };
    payer_info?: { email_address?: string; account_id?: string; [key: string]: unknown };
    [key: string]: unknown;
  }[];
  total_items?: number;
  total_pages?: number;
  page?: number;
  [key: string]: unknown;
}

export interface BalancesResponse {
  balances: {
    currency: string;
    primary?: boolean;
    total_balance: Money;
    available_balance?: Money;
    withheld_balance?: Money;
    [key: string]: unknown;
  }[];
  as_of_time?: string;
  last_refresh_time?: string;
  [key: string]: unknown;
}

export interface DisputeSummary {
  dispute_id: string;
  status?: string;
  reason?: string;
  dispute_amount?: Money;
  create_time?: string;
  [key: string]: unknown;
}

export interface Dispute extends DisputeSummary {
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string; [key: string]: unknown }[];
  dispute_state?: string;
  [key: string]: unknown;
}

export interface WebhookEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  resource: Record<string, unknown>;
  create_time?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface Webhook {
  id: string;
  url: string;
  event_types: { name: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

export interface IdentityToken {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
}

export interface IdentityUserInfo {
  user_id: string;
  name?: string;
  email?: string;
  emails?: { value: string; primary?: boolean; confirmed?: boolean; [key: string]: unknown }[];
  verified_account?: string | boolean;
  payer_id?: string;
  [key: string]: unknown;
}
