/** Provider-free contracts for the optional payments plugin. No SDK, keys or card data. */
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import type { ServiceDataScope } from '../auth/service-data-scope';
export interface BillingSubject { kind: 'user' | 'organization'; id: string; tenantId?: string }
export type PaymentProvider = 'stripe' | 'square';
export interface PaymentsAuthority {
  access: RequestAuthorizationAccess; scope: ServiceDataScope;
  assertCurrentAuthority: () => Promise<void>; assertCurrentAuthoritySync: () => void; signal?: AbortSignal;
}
export interface PaymentCommand { operationId: string }
export interface BillingOperation { operationId: string; status: 'pending' | 'complete' | 'rejected' | 'retryable' | 'unknown'; createdAt: string; error: string | null; retryAfterMs: number }
export interface CheckoutRequest extends PaymentCommand { offer: string; quantity?: number }
export interface SubscriptionChange extends PaymentCommand {
  subscriptionId: string; offer: string; quantity?: number;
  proration: 'create_prorations' | 'always_invoice' | 'none';
  paymentBehavior: 'pending_if_incomplete' | 'error_if_incomplete';
  /** Reuse the preview's timestamp for identical proration math. */
  prorationDate?: number;
}
export interface RefundRequest extends PaymentCommand { paymentId: string; amount?: number; reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent' }
/** Trusted merchant-only intent. Never accepted by the self-service browser routes. Amounts are integer minor units. */
export interface MerchantCheckoutRequest extends PaymentCommand { total: Money; description: string; reference?: string }
export interface MerchantChargeRequest extends MerchantCheckoutRequest {
  /** Stripe PaymentMethod ID or Square Web Payments token; never PAN/CVV. */
  paymentToken: string;
  /** Optional Square buyer-verification token. */
  verificationToken?: string;
}
export interface MerchantCheckout { id: string; url: string | null; status: string | null }
/** Trusted server integration only. Obtaining a payment token does not itself grant permission to charge it. */
export interface MerchantPayments {
  operations: { read(operationId: string): Promise<BillingOperation | null> };
  create(input: MerchantChargeRequest): Promise<BillingPayment>;
  checkout(input: MerchantCheckoutRequest): Promise<MerchantCheckout>;
  read(paymentId: string): Promise<BillingPayment>;
  readCheckout(checkoutId: string): Promise<{ id: string; status: string | null; paymentStatus: string }>;
  refund(input: RefundRequest): Promise<BillingRefund>;
  /** Separate, authorized capability retrieval; never persisted or included in reactive snapshots. */
  clientAction(paymentId: string): Promise<{ provider: 'stripe'; clientSecret: string } | null>;
}
export interface MerchantPaymentEvent {
  eventId: string; type: string; provider: PaymentProvider; providerCreatedAt: number;
  operationId: string; reference?: string;
  resource: BillingEvent['resource'];
}
export interface Money { amount: number; currency: string }
export interface BillingOffer { id: string; label: string; kind: 'payment' | 'subscription'; quantity: { min: number; max: number }; features: Record<string, boolean | number>; unitAmount?: number | null; currency?: string; interval?: string }
export interface BillingPageQuery { limit?: number; after?: string }
export interface BillingPage<T> { items: T[]; next?: string }
export interface BillingSubscription {
  id: string; status: string; offers: string[]; quantity: number; cancelAtPeriodEnd: boolean;
  cancelAt: number | null; trialEnd: number | null; currentPeriodEnd: number | null;
  /** A scheduled plan switch, distinct from the currently billed offers. */
  pendingChange?: { offers: readonly string[]; effectiveAt: number | null };
}
export interface BillingInvoice { id: string; number: string | null; status: string | null; total: Money; paid: boolean; createdAt: number; dueAt: number | null }
export interface BillingPayment { id: string; status: string; total: Money; refunded: number; createdAt: number }
export interface BillingRefund { id: string; status: string | null; total: Money; paymentId: string; createdAt: number }
export interface BillingSnapshot {
  subject: BillingSubject; provider: PaymentProvider; mode: 'test' | 'live'; revision: number;
  customer: { id: string; email?: string; name?: string } | null;
  subscriptions: BillingSubscription[]; invoices: BillingInvoice[]; payments: BillingPayment[];
  entitlements: Record<string, boolean | number>; reconciledAt: string | null; stale: boolean; error?: string;
  policyVersion: string; entitlementsValidUntil: number | null;
  /** Changes when either the stored revision or time-sensitive access state changes. */
  version?: string;
}
export interface BillingRevision { revision: number; version?: string }
export interface PaymentsReadiness {
  enabled: boolean; provider: PaymentProvider; mode: 'test' | 'live'; acceptingSales: boolean;
  apiVersion: string; webhookPath: string; operations: readonly string[];
  /** Optional additive detail; absent on older providers. Unsupported semantics must never be silently emulated. */
  capabilities?: PaymentsCapabilities;
}
export interface PaymentsCapabilities {
  hostedCheckout: boolean; customerPortal: boolean; subscriptionPreview: boolean;
  subscriptionChange: 'immediate-proration' | 'next-period' | 'unsupported';
  cancellation: readonly ('period-end' | 'immediate')[];
  invoicePdf: boolean;
}
/** Verified event identity plus a freshly retrieved resource; timestamps are not ordering locks. */
export interface BillingEvent {
  eventId: string; type: string; subject: BillingSubject; providerCreatedAt: number;
  resource: { id: string; kind: string; status: string | null; paymentStatus?: string; total?: Money; offer?: string };
}
/** Current subject only. Arbitrary merchant/customer/tenant selectors are deliberately absent. */
export interface ScopedPayments {
  status(): PaymentsReadiness; catalog(): Promise<readonly BillingOffer[]>; snapshot(): Promise<BillingSnapshot>;
  customers: { ensure(input: PaymentCommand): Promise<{ id: string }> };
  operations: { read(operationId: string): Promise<BillingOperation | null> };
  checkout: {
    create(input: CheckoutRequest): Promise<{ id: string; url: string | null; status: string | null }>;
    read(id: string): Promise<{ id: string; status: string | null; paymentStatus: string }>;
  };
  portal: { create(input: PaymentCommand): Promise<{ url: string }> };
  subscriptions: {
    list(): Promise<BillingSubscription[]>;
    preview(input: Omit<SubscriptionChange, 'operationId' | 'paymentBehavior'>): Promise<{ total: Money; amountDue: Money; prorationDate: number }>;
    change(input: SubscriptionChange): Promise<BillingSubscription>;
    cancel(input: PaymentCommand & { subscriptionId: string; timing: 'period-end' | 'immediate' }): Promise<BillingSubscription>;
    resume(input: PaymentCommand & { subscriptionId: string }): Promise<BillingSubscription>;
  };
  invoices: { list(query?: BillingPageQuery): Promise<BillingPage<BillingInvoice>>; read(id: string): Promise<BillingInvoice>; document(id: string): Promise<{ hostedUrl: string | null; pdfUrl: string | null }> };
  payments: { list(query?: BillingPageQuery): Promise<BillingPage<BillingPayment>> };
  refunds: { create(input: RefundRequest): Promise<BillingRefund>; list(input: BillingPageQuery & { paymentId: string }): Promise<BillingPage<BillingRefund>> };
  entitlements: { read(): Promise<Record<string, boolean | number>> };
  reconcile(): Promise<BillingSnapshot>;
  watch(options?: { signal?: AbortSignal }): AsyncIterable<BillingRevision>;
}
/** Trusted setup boundary; HTTP/machine contexts receive only forAuthority's closed facade. */
export interface PaymentsBackend { status(): PaymentsReadiness; forAuthority(authority: PaymentsAuthority): ScopedPayments }
