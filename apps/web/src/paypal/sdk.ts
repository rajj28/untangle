import type { DetailedHTMLProps, HTMLAttributes } from "react";

export interface PayPalApproveData {
  orderId: string;
}

export interface PayPalEligibility {
  isEligible(method: "paypal"): boolean;
}

export interface PayPalOneTimePaymentSession {
  start(
    options: { presentationMode: "auto" },
    order: Promise<{ orderId: string }>,
  ): Promise<void> | void;
}

export interface PayPalInstance {
  findEligibleMethods(): Promise<PayPalEligibility>;
  createPayPalOneTimePaymentSession(options: {
    onApprove(data: PayPalApproveData): void | Promise<void>;
    onCancel(): void;
    onError(error: { message: string }): void;
  }): Promise<PayPalOneTimePaymentSession>;
}

interface PayPalSdk {
  createInstance(options: { clientId: string; components: ["paypal-payments"] }): Promise<PayPalInstance>;
}

declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

const scriptLoads = new Map<string, Promise<PayPalSdk>>();
const instances = new Map<string, Promise<PayPalInstance>>();

export function loadPayPalSdk(url: string): Promise<PayPalSdk> {
  const existing = window.paypal;
  if (existing !== undefined) return Promise.resolve(existing);
  const cached = scriptLoads.get(url);
  if (cached !== undefined) return cached;

  const loading = new Promise<PayPalSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      if (window.paypal === undefined) {
        scriptLoads.delete(url);
        script.remove();
        reject(new Error("PayPal SDK loaded without exposing its API."));
      } else {
        resolve(window.paypal);
      }
    };
    script.onerror = () => {
      // Remove the failed promise and the <script> element so a later attempt can retry.
      scriptLoads.delete(url);
      script.remove();
      reject(new Error("The PayPal checkout library could not be loaded."));
    };
    document.head.append(script);
  });
  scriptLoads.set(url, loading);
  return loading;
}

export async function getPayPalInstance(url: string, clientId: string): Promise<PayPalInstance> {
  const cached = instances.get(clientId);
  if (cached !== undefined) return cached;

  const creating = loadPayPalSdk(url).then(
    (sdk) => sdk.createInstance({ clientId, components: ["paypal-payments"] }),
    (error: unknown) => {
      // Remove the failed instance promise so a later call can retry.
      instances.delete(clientId);
      throw error;
    },
  );
  instances.set(clientId, creating);
  return creating;
}
